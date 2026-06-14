// Knowledge Graph — Cosmograph(GPU force-graph) 기반 렌더러
// 기존 Sigma 구현은 graphViz.sigma.js.bak 에 백업되어 있음.
// 패널(gp-*)·툴팁(gt-*) HTML 구조는 graph.astro의 CSS를 그대로 재사용한다.
import { Cosmograph } from "@cosmograph/cosmograph";

// ── 공통 상수 ────────────────────────────────────────────────────────────────
const TYPE_LABELS = {
  category: "카테고리",
  subcategory: "서브카테고리",
  series: "시리즈",
  tag: "태그",
  post: "포스트",
};

const DIFFICULTY_LABELS = { beginner: "입문", intermediate: "중급", advanced: "고급" };

function isDarkMode() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

// 노드 색은 community(토픽 클러스터) 기준으로 칠한다 — Cosmograph 데모처럼
// 클러스터마다 다른 색이 들어가 구조가 한눈에 보인다.
// golden-angle(137.5°)로 균등 분포 hue 생성, 테마별 채도/명도만 조정.
const GOLDEN_ANGLE = 137.508;
function communityColor(community, comm) {
  const h = ((community || 0) * GOLDEN_ANGLE) % 360;
  return `hsl(${h.toFixed(1)}, ${comm.s}%, ${comm.l}%)`;
}

// 테마별 캔버스/링크/라벨 색
function vizColors(dark) {
  return dark
    ? {
        comm: { s: 70, l: 63 }, // 다크: 밝고 선명
        linkAlpha: 0.55, // 링크는 source 커뮤니티 색 + 이 알파
        label: "#f1f5f9",
        ring: "#ffffff",
        fallback: "#94a3b8",
      }
    : {
        comm: { s: 58, l: 48 }, // 라이트: 채도 있고 약간 어둡게(흰 배경 가독)
        linkAlpha: 0.5,
        label: "#1e293b",
        ring: "#0f172a",
        fallback: "#64748b",
      };
}

// 링크는 source 노드의 커뮤니티 색을 따른다 (같은 클러스터 = 같은 색 흐름)
function linkColorFor(srcNode, V) {
  const h = ((srcNode?.community || 0) * GOLDEN_ANGLE) % 360;
  return `hsla(${h.toFixed(1)}, ${V.comm.s}%, ${V.comm.l}%, ${V.linkAlpha})`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── 메인 진입점 ──────────────────────────────────────────────────────────────
let _instance = null;

window.initGraphViz = function initGraphViz() {
  const container = document.getElementById("sigma-container");
  const data = window.__GRAPH_DATA__;
  if (!container || !data) return;

  // astro:page-load가 중복 호출될 수 있으므로 컨테이너 단위로 가드
  if (container.__cosmoInited) return;
  container.__cosmoInited = true;

  // 이전 인스턴스가 살아있으면 정리 (뷰 트랜지션 대비)
  if (_instance) {
    try {
      _instance.remove();
    } catch (e) {
      /* noop */
    }
    _instance = null;
  }

  // ── 데이터 인덱싱 ──────────────────────────────────────────────────────────
  const nodesById = new Map();
  data.nodes.forEach(n => nodesById.set(n.id, n));

  // 인접 노드 (양방향)
  const adjacency = new Map();
  data.nodes.forEach(n => adjacency.set(n.id, []));
  data.edges.forEach(e => {
    const a = adjacency.get(e.source);
    const b = adjacency.get(e.target);
    if (a && b) {
      a.push(e.target);
      b.push(e.source);
    }
  });
  const degreeOf = id => (adjacency.get(id) || []).length;

  // graph-data.json의 모든 노드 x/y가 0이라, 그대로 넣으면 force layout이
  // 한 점에 겹친 채 시작해 퍼지지 않는다. x/y를 제거해 Cosmograph가
  // 무작위 초기 위치를 잡도록 한다. (색/크기/url 등 나머지 속성은 유지)
  const renderNodes = data.nodes.map(({ x, y, ...rest }) => rest);

  // ── 상태 ───────────────────────────────────────────────────────────────────
  // 체크박스 기본값과 동기화: post는 기본 off
  const activeTypes = new Set();
  document.querySelectorAll(".graph-filter-cb").forEach(cb => {
    if (cb.checked) activeTypes.add(cb.dataset.type);
  });
  if (activeTypes.size === 0) {
    ["category", "subcategory", "series", "tag"].forEach(t => activeTypes.add(t));
  }

  const state = { selected: null, hovered: null, searchNodes: [] };

  // post 노드 → 연결된 태그 id 집합 (비슷한 글 계산용)
  const postTagSet = new Map();
  data.nodes.forEach(n => {
    if (n.type === "post") {
      const tags = (adjacency.get(n.id) || []).filter(
        id => nodesById.get(id)?.type === "tag"
      );
      postTagSet.set(n.id, new Set(tags));
    }
  });

  // 레이아웃/렌더에는 구조적(트리) 엣지만 사용한다.
  // tagCooccurs/related/dependsOn은 태그를 한 덩어리로 엉키게 하므로 제외.
  // (단 패널의 '연결 노드'는 위 adjacency = 전체 엣지를 그대로 사용)
  const RENDER_EDGE_TYPES = new Set([
    "hasTag",
    "inCategory",
    "inSubcategory",
    "inSeries",
  ]);

  // 현재 활성 타입에 맞는 노드/엣지 부분집합
  function visibleData() {
    const visNodes = renderNodes.filter(n => activeTypes.has(n.type));
    const visIds = new Set(visNodes.map(n => n.id));
    const visEdges = data.edges.filter(
      e =>
        RENDER_EDGE_TYPES.has(e.type) &&
        visIds.has(e.source) &&
        visIds.has(e.target)
    );
    return { nodes: visNodes, links: visEdges };
  }

  let V = vizColors(isDarkMode());

  // 클러스터 앵커: 카테고리/서브카테고리 노드에 토픽 이름을 고정 라벨로 표시
  // → 그래프만 봐도 각 색 영역이 무슨 주제인지 파악된다.
  const labelHubs = renderNodes.filter(
    n => n.type === "category" || n.type === "subcategory"
  );

  // 노드 크기: 연결 많은 허브일수록 크게(degree 기반 size) + 분류 허브 가중
  function nodeSizeFor(n) {
    const base = Math.max(3, (n.size || 8) * 0.55);
    if (n.type === "category") return base * 1.7;
    if (n.type === "subcategory") return base * 1.35;
    if (n.type === "series") return base * 1.2;
    return base;
  }

  // ── Cosmograph 인스턴스 ─────────────────────────────────────────────────────
  const cosmograph = new Cosmograph(container, {
    // 투명 배경 → CSS가 테마별 배경(라이트 클린 / 다크 차분) 담당
    backgroundColor: "rgba(0, 0, 0, 0)",
    nodeColor: n => communityColor(n.community, V.comm),
    nodeSize: nodeSizeFor,
    nodeSizeScale: 1,
    // 호버/선택 시 비이웃 노드는 흐리게
    nodeGreyoutOpacity: 0.07,

    renderLinks: true,
    // 링크를 source 노드의 커뮤니티 색으로 → 클러스터별 색 흐름이 보인다
    linkColor: link =>
      linkColorFor(nodesById.get(link.source?.id ?? link.source), V),
    linkWidth: 1.4,
    linkWidthScale: 1,
    // 호버/선택 시 비관련 엣지는 숨김 → 해당 노드 연결만 또렷
    linkGreyoutOpacity: 0,
    // 줌 레벨/링크 길이와 무관하게 거의 항상 또렷하게 (짧은 링크도 안 사라지게)
    linkVisibilityDistanceRange: [1, 6],
    linkVisibilityMinTransparency: 0.75,
    curvedLinks: true,
    curvedLinkSegments: 16,
    curvedLinkWeight: 0.5,
    curvedLinkControlPointDistance: 0.4,

    // 분류 허브에 토픽 이름 고정 라벨 + 호버 라벨
    showDynamicLabels: false,
    showTopLabels: false,
    showLabelsFor: labelHubs,
    showHoveredNodeLabel: true,
    nodeLabelAccessor: n => n.label || n.id,
    nodeLabelColor: V.label,
    hoveredNodeLabelColor: V.label,

    renderHoveredNodeRing: true,
    hoveredNodeRingColor: V.ring,
    focusedNodeRingColor: V.ring,

    // 시뮬레이션 — 클러스터 내부도 살짝 벌려 연결선이 보이게(노드에 안 가리게)
    simulationGravity: 0.06,
    simulationCenter: 0.03,
    simulationRepulsion: 1.5,
    simulationRepulsionTheta: 1.2,
    simulationLinkSpring: 0.4,
    simulationLinkDistance: 18,
    simulationFriction: 0.9,
    simulationDecay: 4000,
    useQuadtree: true,
    spaceSize: 4096,

    fitViewOnInit: true,
    fitViewDelay: 3000,
    scaleNodesOnZoom: true,

    onClick: node => {
      if (node) showNode(node);
      else {
        clearNode();
        renderList(currentQuery);
      }
    },
    onLabelClick: node => {
      if (node) showNode(node);
    },
    onNodeMouseOver: (node, _i, _pos, ev) => {
      state.hovered = node;
      container.style.cursor = "pointer";
      showTooltip(node, ev);
      // 호버한 노드 + 이웃만 강조, 나머지는 흐려짐 (Obsidian 방식)
      try {
        cosmograph.selectNode(node, true);
      } catch (e) {
        /* noop */
      }
    },
    onNodeMouseOut: () => {
      state.hovered = null;
      container.style.cursor = "default";
      hideTooltip();
      applyHighlight();
    },
  });

  const vis = visibleData();
  cosmograph.setData(vis.nodes, vis.links);
  _instance = cosmograph;

  // ── 툴팁 ─────────────────────────────────────────────────────────────────
  const tooltip = document.getElementById("graph-tooltip");

  function showTooltip(node, ev) {
    if (!tooltip || !node) return;
    const typeLabel = TYPE_LABELS[node.type] || node.type;
    let html = `<div class="gt-type gt-type--${node.type}">${escapeHtml(typeLabel)}</div>`;
    html += `<div class="gt-label">${escapeHtml(node.label)}</div>`;
    if (node.date) html += `<div class="gt-meta">${escapeHtml(node.date)}</div>`;
    html += `<div class="gt-meta">연결 ${degreeOf(node.id)}개</div>`;
    html += `<div class="gt-hint">${node.type === "post" ? "클릭하여 열기" : "클릭하여 상세 보기"}</div>`;
    tooltip.innerHTML = html;
    tooltip.classList.add("is-visible");
    positionTooltip(ev);
  }
  function hideTooltip() {
    tooltip?.classList.remove("is-visible");
  }
  function positionTooltip(ev) {
    if (!tooltip || !ev) return;
    const rect = container.getBoundingClientRect();
    const cx = ev.clientX ?? ev.sourceEvent?.clientX ?? 0;
    const cy = ev.clientY ?? ev.sourceEvent?.clientY ?? 0;
    const x = cx - rect.left;
    const y = cy - rect.top;
    const tw = tooltip.offsetWidth || 200;
    const th = tooltip.offsetHeight || 80;
    tooltip.style.left = (x + 16 + tw > rect.width ? x - tw - 8 : x + 16) + "px";
    tooltip.style.top = (y + 16 + th > rect.height ? y - th - 8 : y + 12) + "px";
  }
  container.addEventListener("mousemove", e => {
    if (state.hovered && tooltip?.classList.contains("is-visible")) {
      positionTooltip(e);
    }
  });

  // ── 우측 검색엔진 패널 (좌 그래프 / 우 검색·결과·상세) ──────────────────────
  const sideBody = document.getElementById("graph-panel-body");
  const searchInput = document.getElementById("graph-search");
  const searchClear = document.getElementById("graph-search-clear");

  // 기본 브라우즈 목록 = 전체 글(최신순)
  const allPosts = data.nodes
    .filter(n => n.type === "post" && n.url)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const TYPE_ORDER = { post: 0, tag: 1, subcategory: 2, category: 3, series: 4 };
  let currentQuery = "";
  const searchMode = "hybrid"; // 단일 검색 로직: BM25 키워드 + e5 의미 벡터 결합 (실패 시 텍스트 폴백)

  // ── 검색 엔진 (Phase 1: 텍스트 BM25) ───────────────────────────────────────
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/sonblog-astro"
  // 글 URL → graph 노드 매핑 (검색 결과를 그래프와 연결)
  const urlToNode = new Map();
  data.nodes.forEach(n => {
    if (n.type === "post" && n.url) urlToNode.set(n.url.replace(/\/$/, ""), n);
  });

  let _orama = null; // { db, search, docs }
  let _oramaPromise = null;
  function ensureSearch() {
    if (_orama) return Promise.resolve(_orama);
    if (_oramaPromise) return _oramaPromise;
    _oramaPromise = (async () => {
      const orama = await import("@orama/orama");
      const docs = await fetch(`${BASE}/search-index.json`).then(r => r.json());
      const db = await orama.create({
        schema: {
          title: "string",
          description: "string",
          tags: "string[]",
          body: "string",
          category: "string",
          url: "string",
          date: "string",
        },
        components: { tokenizer: { stemming: false } },
      });
      await orama.insertMultiple(db, docs);
      const byUrl = new Map();
      docs.forEach(d => byUrl.set((d.url || "").replace(/\/$/, ""), d));
      _orama = { db, search: orama.search, docs, byUrl };
      return _orama;
    })();
    return _oramaPromise;
  }

  // 쿼리 주변 스니펫 추출
  function snippetFor(doc, q) {
    const hay = `${doc.body || ""}`;
    const i = hay.toLowerCase().indexOf(q);
    if (i >= 0) {
      const s = Math.max(0, i - 50);
      return (s > 0 ? "…" : "") + hay.slice(s, i + q.length + 90).trim() + "…";
    }
    const desc = doc.description || doc.body || "";
    return desc ? desc.slice(0, 130) + (desc.length > 130 ? "…" : "") : "";
  }
  // ── 시멘틱 검색 (Phase 3: 빌드 임베딩 + 브라우저 WebGPU 쿼리 임베딩) ─────────
  const SEM_MODEL = "Xenova/multilingual-e5-small";
  const statusEl = document.getElementById("gs-status");
  function setStatus(msg) {
    if (!statusEl) return;
    if (msg) {
      statusEl.textContent = msg;
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

  // 사전 계산된 문서 벡터 (int8 → Float32 정규화)
  let _vectors = null;
  let _vectorsPromise = null;
  function ensureVectors() {
    if (_vectors) return Promise.resolve(_vectors);
    if (_vectorsPromise) return _vectorsPromise;
    _vectorsPromise = (async () => {
      const data = await fetch(`${BASE}/search-vectors.json`).then(r => r.json());
      const map = new Map();
      for (const url in data.vectors) {
        const i8 = Int8Array.from(atob(data.vectors[url]), c => c.charCodeAt(0));
        const f = new Float32Array(i8.length);
        for (let i = 0; i < i8.length; i++) f[i] = i8[i] / 127;
        map.set(url.replace(/\/$/, ""), f);
      }
      _vectors = { dim: data.dim, map };
      return _vectors;
    })();
    return _vectorsPromise;
  }

  // 브라우저 쿼리 임베더 (WebGPU → 없으면 WASM 폴백). CDN ESM 동적 import.
  let _embedder = null;
  let _embedderPromise = null;
  let _embedBackend = "";
  function ensureEmbedder() {
    if (_embedder) return Promise.resolve(_embedder);
    if (_embedderPromise) return _embedderPromise;
    _embedderPromise = (async () => {
      setStatus("AI 모델 로딩…");
      const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
      const T = await import(/* @vite-ignore */ CDN);
      // WASM 폴백 안정화: 단일 스레드(COEP 불필요), proxy 끔
      try {
        T.env.backends.onnx.wasm.numThreads = 1;
        T.env.backends.onnx.wasm.proxy = false;
      } catch (e) {
        /* noop */
      }
      // WebGPU 실제 가용성 확인 → 있으면 GPU(3080), 없으면 WASM
      let device = "wasm";
      try {
        if (navigator.gpu && (await navigator.gpu.requestAdapter())) {
          device = "webgpu";
        }
      } catch (e) {
        /* webgpu 미지원 → wasm */
      }
      const onProgress = p => {
        if (p.status === "progress" && /\.onnx/.test(p.file || "")) {
          setStatus(`AI 모델 다운로드 ${Math.round(p.progress || 0)}%`);
        }
      };
      const ex = await T.pipeline("feature-extraction", SEM_MODEL, {
        dtype: "q8",
        device,
        progress_callback: onProgress,
      });
      _embedder = ex;
      _embedBackend = device;
      console.log(`[semantic] backend: ${device}`);
      return ex;
    })();
    return _embedderPromise;
  }

  async function embedQuery(q) {
    const ex = await ensureEmbedder();
    const out = await ex(`query: ${q}`, { pooling: "mean", normalize: true });
    return out.data; // Float32Array(dim), 정규화됨
  }

  // 코사인(정규화 벡터 → 내적) 랭킹 → [{url, score}]
  function cosineRank(qvec, limit) {
    const res = [];
    _vectors.map.forEach((vec, url) => {
      let s = 0;
      const n = Math.min(qvec.length, vec.length);
      for (let i = 0; i < n; i++) s += qvec[i] * vec[i];
      res.push({ url, score: s });
    });
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, limit || 60);
  }

  // 첫 매치 1곳만 <mark> 강조 (안전하게 escape)
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, i)) +
      "<mark>" +
      escapeHtml(text.slice(i, i + q.length)) +
      "</mark>" +
      escapeHtml(text.slice(i + q.length))
    );
  }

  // 비슷한 글: 공통 태그 Jaccard + 같은 커뮤니티 보너스
  function similarPosts(node, limit) {
    const myTags = postTagSet.get(node.id);
    if (!myTags || !myTags.size) return [];
    const scored = [];
    postTagSet.forEach((tags, pid) => {
      if (pid === node.id) return;
      let shared = 0;
      tags.forEach(t => {
        if (myTags.has(t)) shared++;
      });
      if (!shared) return;
      const other = nodesById.get(pid);
      if (!other) return;
      const jaccard = shared / (myTags.size + tags.size - shared);
      const commBonus = other.community === node.community ? 0.12 : 0;
      scored.push({ node: other, score: jaccard + commBonus, shared });
    });
    scored.sort((a, b) => b.score - a.score || b.shared - a.shared);
    return scored.slice(0, limit || 5);
  }

  // 노드 상세 HTML 빌더
  function buildDetailHTML(node) {
    const typeLabel = TYPE_LABELS[node.type] || node.type;
    const neighborIds = adjacency.get(node.id) || [];
    const neighbors = neighborIds.map(id => nodesById.get(id)).filter(Boolean);
    const posts = neighbors
      .filter(n => n.type === "post")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const others = neighbors.filter(n => n.type !== "post");
    const deg = neighbors.length;

    let header = `<div class="gp-node-header gp-node-header--${node.type}">`;
    header += `<div class="gp-header-row">`;
    header += `<div class="gp-type gp-type--${node.type}">${escapeHtml(typeLabel)}</div>`;
    const stats = [`${deg} 연결`];
    if (posts.length) stats.push(`${posts.length} 포스트`);
    if (others.length) stats.push(`${others.length} 노드`);
    header += `<span class="gp-inline-stats">${stats.join(" · ")}</span></div>`;
    header += `<h2 class="gp-title">${escapeHtml(node.label)}</h2>`;
    const meta = [];
    if (node.series) meta.push(`<span class="gp-meta-series">${escapeHtml(node.series)}</span>`);
    if (node.date) meta.push(`<span class="gp-meta-date">${escapeHtml(node.date)}</span>`);
    if (node.difficulty) {
      const d = DIFFICULTY_LABELS[node.difficulty] || node.difficulty;
      meta.push(`<span class="gp-meta-diff gp-meta-diff--${node.difficulty}">${escapeHtml(d)}</span>`);
    }
    if (meta.length) header += `<div class="gp-meta-line">${meta.join("")}</div>`;
    header += `</div>`;

    let body = `<div class="gp-scroll-body">`;
    if (posts.length > 0) {
      body += `<div class="gp-section"><div class="gp-section-title">연관 포스트<span class="gp-section-count">${posts.length}</span></div><ul class="gp-post-list">`;
      posts.forEach(p => {
        const dateStr = p.date ? `<span class="gp-post-date">${escapeHtml(p.date)}</span>` : "";
        body +=
          `<li class="gp-post-item">` +
          (p.url
            ? `<a href="${escapeHtml(p.url)}" class="gp-post-link">${escapeHtml(p.label)}</a>${dateStr}`
            : `<span class="gp-post-label">${escapeHtml(p.label)}</span>${dateStr}`) +
          `</li>`;
      });
      body += `</ul></div>`;
    }
    if (others.length > 0) {
      const order = ["category", "subcategory", "series", "tag"];
      const grouped = {};
      others.forEach(n => (grouped[n.type] = grouped[n.type] || []).push(n));
      body += `<div class="gp-section"><div class="gp-section-title">연결 노드<span class="gp-section-count">${others.length}</span></div>`;
      order.forEach(t => {
        if (!grouped[t] || !grouped[t].length) return;
        body += `<div class="gp-conn-group"><span class="gp-conn-group-label gp-type--${t}">${escapeHtml(TYPE_LABELS[t])}</span><div class="gp-tags">`;
        grouped[t].forEach(n => {
          body += `<span class="gp-tag gp-tag--${n.type}" data-node-id="${escapeHtml(n.id)}">${escapeHtml(n.label)}</span>`;
        });
        body += `</div></div>`;
      });
      body += `</div>`;
    }

    // 비슷한 글 (포스트 노드만)
    if (node.type === "post") {
      const sim = similarPosts(node, 5);
      if (sim.length) {
        body += `<div class="gp-section"><div class="gp-section-title">비슷한 글<span class="gp-section-count">${sim.length}</span></div><ul class="gp-post-list">`;
        sim.forEach(s => {
          const dateStr = s.node.date ? `<span class="gp-post-date">${escapeHtml(s.node.date)}</span>` : "";
          body += `<li class="gp-post-item"><span class="gp-post-link gs-nav" data-node-id="${escapeHtml(s.node.id)}">${escapeHtml(s.node.label)}</span>${dateStr}</li>`;
        });
        body += `</ul></div>`;
      }
    }
    body += `</div>`;

    let footer = "";
    if (node.type === "post" && node.url) {
      footer =
        `<div class="gp-panel-footer"><a class="gp-open-btn" href="${escapeHtml(node.url)}">글 읽기` +
        `<svg class="gp-open-btn-icon" viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>`;
    }
    return header + body + footer;
  }

  // 노드 상세 보기 (그래프 포커스 + 우측 패널 상세 + '검색으로' 뒤로가기)
  function showNode(node) {
    if (!node || !sideBody) return;
    state.selected = node;
    try {
      cosmograph.selectNode(node, true);
      cosmograph.focusNode(node);
      cosmograph.zoomToNode(node);
    } catch (e) {
      /* noop */
    }
    sideBody.innerHTML =
      `<button type="button" class="gs-back" id="gs-back"><svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>검색으로</button>` +
      buildDetailHTML(node);
    sideBody.scrollTop = 0;
    document.getElementById("gs-back")?.addEventListener("click", () => {
      clearNode();
      renderList(currentQuery);
    });
    sideBody
      .querySelectorAll(".gp-tag[data-node-id], .gs-nav[data-node-id]")
      .forEach(el => {
        el.addEventListener("click", () => {
          const t = nodesById.get(el.dataset.nodeId);
          if (t) showNode(t);
        });
      });
  }

  // 그래프 선택 해제 (전체 노드 복원)
  // 현재 상태(선택 노드 > 검색결과 > 없음)에 맞춰 그래프 강조 적용
  function applyHighlight() {
    try {
      if (state.selected) cosmograph.selectNode(state.selected, true);
      else if (state.searchNodes.length) cosmograph.selectNodes(state.searchNodes);
      else cosmograph.unselectNodes();
    } catch (e) {
      /* noop */
    }
  }

  function clearNode() {
    state.selected = null;
    try {
      cosmograph.focusNode(undefined);
    } catch (e) {
      /* noop */
    }
    applyHighlight();
  }

  // 결과 항목 렌더 (entries: {nodeId,label,type,date,snippetHtml,labelHtml})
  function renderEntries(sections) {
    let html = "";
    sections.forEach(sec => {
      if (!sec.entries.length) return;
      html += `<div class="gs-section-head">${sec.head}<span class="gs-count">${sec.count ?? sec.entries.length}</span></div><ul class="gs-list">`;
      sec.entries.forEach(e => {
        const date = e.date ? `<span class="gs-item-date">${escapeHtml(e.date)}</span>` : "";
        const snip = e.snippetHtml ? `<div class="gs-item-snippet">${e.snippetHtml}</div>` : "";
        html +=
          `<li class="gs-item" data-node-id="${escapeHtml(e.nodeId)}">` +
          `<div class="gs-item-main"><span class="gt-type gt-type--${e.type}">${escapeHtml(TYPE_LABELS[e.type] || e.type)}</span>` +
          `<span class="gs-item-label">${e.labelHtml || escapeHtml(e.label)}</span>${date}</div>${snip}</li>`;
      });
      html += `</ul>`;
    });
    if (!html) html = `<div class="gs-section-head">검색결과<span class="gs-count">0</span></div><div class="gs-empty">결과가 없습니다</div>`;
    sideBody.innerHTML = html;
    sideBody.scrollTop = 0;
    sideBody.querySelectorAll(".gs-item").forEach(el => {
      el.addEventListener("click", () => {
        const node = nodesById.get(el.dataset.nodeId);
        if (!node) return;
        if (!activeTypes.has(node.type)) {
          activeTypes.add(node.type);
          const cb = document.querySelector(`.graph-filter-cb[data-type="${node.type}"]`);
          if (cb) cb.checked = true;
          const v = visibleData();
          cosmograph.setData(v.nodes, v.links, false);
        }
        showNode(node);
      });
    });
  }

  // 검색/브라우즈 결과 목록 렌더
  async function renderList(query) {
    if (!sideBody) return;
    currentQuery = query || "";
    const q = currentQuery.trim();
    if (searchClear) searchClear.style.display = q ? "flex" : "none";

    // 빈 쿼리 → 전체 글 브라우즈 + 그래프 강조 해제
    if (!q) {
      state.searchNodes = [];
      if (!state.selected) applyHighlight();
      renderEntries([
        {
          head: "전체 글",
          entries: allPosts.map(n => ({
            nodeId: n.id,
            label: n.label,
            type: n.type,
            date: n.date,
          })),
        },
      ]);
      return;
    }

    // 로딩 표시 (인덱스 첫 로드 시)
    if (!_orama) {
      sideBody.innerHTML = `<div class="gs-section-head">검색 중…</div>`;
    }

    const ql = q.toLowerCase();
    const reqQuery = currentQuery; // 경쟁 조건 가드
    const mode = searchMode;
    let engine;
    try {
      engine = await ensureSearch(); // 제목·스니펫용으로 항상 필요
    } catch (e) {
      engine = null;
    }
    if (reqQuery !== currentQuery) return;

    const seen = new Set();
    const postEntries = [];
    const pushDoc = doc => {
      if (!doc || postEntries.length >= 80) return;
      const node = urlToNode.get((doc.url || "").replace(/\/$/, ""));
      if (!node || seen.has(node.id)) return;
      seen.add(node.id);
      postEntries.push({
        nodeId: node.id,
        type: "post",
        date: doc.date,
        labelHtml: highlight(doc.title, ql),
        snippetHtml: highlight(snippetFor(doc, ql), ql),
      });
    };

    if (mode === "text") {
      // BM25 + 한국어 부분일치 폴백
      if (engine) {
        try {
          const res = await engine.search(engine.db, {
            term: q,
            properties: ["title", "description", "tags", "body"],
            boost: { title: 4, tags: 3, description: 2, body: 1 },
            tolerance: 1,
            limit: 60,
          });
          res.hits.forEach(h => pushDoc(h.document));
        } catch (e) {
          /* noop */
        }
        engine.docs.forEach(doc => {
          if (
            doc.title.toLowerCase().includes(ql) ||
            (doc.tags || []).some(t => t.toLowerCase().includes(ql)) ||
            (doc.body || "").toLowerCase().includes(ql)
          )
            pushDoc(doc);
        });
      }
    } else {
      // 의미 / 하이브리드 → 문서벡터 + 브라우저 쿼리 임베딩(WebGPU)
      try {
        await ensureVectors();
        const qvec = await embedQuery(q);
        if (reqQuery !== currentQuery) {
          setStatus("");
          return;
        }
        setStatus("");
        const sem = cosineRank(qvec, 80); // [{url, score(-1..1)}]
        if (mode === "hybrid" && engine) {
          const bm = new Map();
          try {
            const res = await engine.search(engine.db, {
              term: q,
              properties: ["title", "description", "tags", "body"],
              boost: { title: 4, tags: 3, description: 2, body: 1 },
              tolerance: 1,
              limit: 80,
            });
            let max = 0;
            res.hits.forEach(h => (max = Math.max(max, h.score)));
            res.hits.forEach(h =>
              bm.set((h.document.url || "").replace(/\/$/, ""), max ? h.score / max : 0)
            );
          } catch (e) {
            /* noop */
          }
          const merged = new Map();
          sem.forEach(r => merged.set(r.url, 0.6 * Math.max(0, r.score)));
          bm.forEach((s, url) =>
            merged.set(url, (merged.get(url) || 0) + 0.4 * s)
          );
          [...merged.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60)
            .forEach(([url]) => pushDoc(engine.byUrl.get(url)));
        } else {
          sem
            .filter(r => r.score > 0.72) // e5 임계값(약한 매칭 컷)
            .forEach(r => pushDoc(engine?.byUrl.get(r.url)));
          if (!postEntries.length)
            sem.slice(0, 20).forEach(r => pushDoc(engine?.byUrl.get(r.url)));
        }
      } catch (e) {
        setStatus("");
        console.warn("[semantic] 실패 → 텍스트 폴백", e);
        if (engine) {
          try {
            const res = await engine.search(engine.db, {
              term: q,
              properties: ["title", "description", "tags", "body"],
              tolerance: 1,
              limit: 60,
            });
            res.hits.forEach(h => pushDoc(h.document));
          } catch (e2) {
            /* noop */
          }
        }
      }
    }

    // 매칭되는 태그/주제 노드 (그래프 탐색용)
    const nodeEntries = data.nodes
      .filter(n => n.type !== "post" && (n.label || "").toLowerCase().includes(ql))
      .sort((a, b) => degreeOf(b.id) - degreeOf(a.id))
      .slice(0, 10)
      .map(n => ({
        nodeId: n.id,
        type: n.type,
        labelHtml: highlight(n.label, ql),
      }));

    if (reqQuery !== currentQuery) return;
    // 매칭 노드를 그래프에 강조 (검색 결과 = 그래프 시각화)
    state.searchNodes = [...postEntries, ...nodeEntries]
      .map(e => nodesById.get(e.nodeId))
      .filter(Boolean);
    if (!state.selected) applyHighlight();

    renderEntries([
      { head: "글", entries: postEntries },
      { head: "태그·주제", entries: nodeEntries },
    ]);
  }

  // ── 필터 ─────────────────────────────────────────────────────────────────
  document.querySelectorAll(".graph-filter-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) activeTypes.add(cb.dataset.type);
      else activeTypes.delete(cb.dataset.type);
      const v = visibleData();
      cosmograph.setData(v.nodes, v.links);
    });
  });

  // ── 하이브리드 단일 검색: 첫 포커스 시 벡터·임베더 미리 로드 ─────────────────
  let _preloaded = false;
  searchInput?.addEventListener("focus", () => {
    if (_preloaded) return;
    _preloaded = true;
    ensureVectors().catch(() => {});
    ensureEmbedder().catch(() => {});
  });

  // ── 검색 입력 (디바운스) ────────────────────────────────────────────────────
  let _searchTimer = 0;
  searchInput?.addEventListener("input", e => {
    const v = e.target.value;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => renderList(v), 120);
  });
  searchClear?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    renderList("");
    searchInput?.focus();
  });
  // 인덱스 idle 프리페치 → 첫 검색 지연 최소화
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => ensureSearch().catch(() => {}), { timeout: 4000 });
  } else {
    setTimeout(() => ensureSearch().catch(() => {}), 2500);
  }

  // ── 초기화 버튼 ───────────────────────────────────────────────────────────
  document.getElementById("graph-reset")?.addEventListener("click", () => {
    clearNode();
    if (searchInput) searchInput.value = "";
    renderList("");
    try {
      cosmograph.fitView(400);
    } catch (e) {
      /* noop */
    }
  });

  // 기본 화면: 우측 패널에 전체 글 목록
  renderList("");

  // 사이트 테마(data-theme)를 MkDocs 스킴으로 미러링 → 패널/툴바가 테마 따라감.
  function syncScheme() {
    document.documentElement.setAttribute(
      "data-md-color-scheme",
      isDarkMode() ? "slate" : "default"
    );
  }
  syncScheme();

  // 테마 토글 시 그래프 색도 갱신 (위치는 유지, 색만 재계산)
  const themeObserver = new MutationObserver(() => {
    syncScheme();
    V = vizColors(isDarkMode());
    try {
      cosmograph.setConfig({
        linkColor: link =>
          linkColorFor(nodesById.get(link.source?.id ?? link.source), V),
        nodeColor: n => communityColor(n.community, V.comm),
        nodeLabelColor: V.label,
        hoveredNodeLabelColor: V.label,
        hoveredNodeRingColor: V.ring,
        focusedNodeRingColor: V.ring,
      });
      const v = visibleData();
      cosmograph.setData(v.nodes, v.links, false); // 위치 유지하며 재색칠
    } catch (e) {
      /* noop */
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
};
