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

// 검색 인덱스의 category(폴더명) → 표시 라벨
const CATEGORY_LABELS = {
  ai: "AI",
  "search-engine": "검색엔진",
  devops: "DevOps",
  "full-stack": "Full Stack",
  notes: "Notes",
  portfolio: "Portfolio",
};

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

  // x/y는 빌드 타임(scripts/add-layout.mjs)에서 ForceAtlas2로 사전 계산되어
  // graph-data.json에 박혀 있다. 그대로 사용하고 클라이언트 시뮬레이션은
  // disableSimulation으로 끈다 → 페이지 열 때 물리 계산 0, 멈춤 없음.
  const renderNodes = data.nodes;

  // ── 상태 ───────────────────────────────────────────────────────────────────
  // 체크박스 기본값과 동기화: post는 기본 off
  const activeTypes = new Set();
  document.querySelectorAll(".graph-filter-cb").forEach(cb => {
    if (cb.checked) activeTypes.add(cb.dataset.type);
  });
  if (activeTypes.size === 0) {
    ["category", "subcategory", "series", "tag"].forEach(t => activeTypes.add(t));
  }

  const state = {
    selected: null,
    hovered: null,
    searchNodes: [],
    clusterNodes: [],
  };
  let renderSeq = 0; // 패널 렌더 소유권 토큰 (비동기 검색이 상세를 덮어쓰는 레이스 방지)

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

  // 노드 크기: 클릭 쉽게 키움(scaleNodesOnZoom=false라 화면 px 고정).
  // 연결 많은 허브일수록 크게 + 분류 허브 가중.
  function nodeSizeFor(n) {
    const base = Math.max(5, (n.size || 8) * 0.8);
    if (n.type === "category") return base * 1.9;
    if (n.type === "subcategory") return base * 1.45;
    if (n.type === "series") return base * 1.25;
    return base;
  }

  // ── Cosmograph 인스턴스 ─────────────────────────────────────────────────────
  // cfg를 변수로 빼서 setConfig 시 전체를 다시 넘긴다
  // (cosmos.setConfig는 부분 전달 시 나머지를 기본값으로 덮어쓰므로 전체 필요)
  const cfg = {
    // 투명 배경 → CSS가 테마별 배경(라이트 클린 / 다크 차분) 담당
    backgroundColor: "rgba(0, 0, 0, 0)",
    nodeColor: n => communityColor(n.community, V.comm),
    nodeSize: nodeSizeFor,
    nodeSizeScale: 1,
    // 호버/선택 시 비이웃 노드는 흐리게(단 맥락은 보이게 — 너무 숨기지 않음)
    nodeGreyoutOpacity: 0.25,

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
    // 곡선 링크는 엣지당 16세그먼트를 시뮬레이션 매 프레임 재계산 →
    // 3005엣지 × 16 = ~4.8만 세그먼트로 초기 로딩 시 브라우저가 멈춤.
    // 직선 링크로 전환해 GPU 지오메트리/메모리 부담 제거.
    curvedLinks: false,

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

    // 레이아웃은 빌드 타임에 사전 계산(scripts/add-layout.mjs)되어 노드 x/y에 들어있다.
    // disableSimulation → Cosmograph는 그 좌표를 그대로 위치로 쓰고 물리 계산을 안 한다.
    // (예전엔 매 페이지 로드마다 force simulation을 돌려 브라우저가 멈췄음)
    disableSimulation: true,
    spaceSize: 8192,

    fitViewOnInit: true,
    fitViewDelay: 250, // 시뮬레이션이 없으니 즉시 화면 맞춤
    // false → 확대해도 노드는 같은 px, 레이아웃만 벌어짐 → 간격 생겨 클릭 쉬움
    scaleNodesOnZoom: false,

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
    // 줌·팬 시 선택 글 마커가 노드를 따라오게
    onZoom: () => positionMarker(),
  };

  // ── 선택된 글 마커 (그래프 노드 위 핀) — cosmograph 생성 전에 선언 ─────────────
  // (생성 중 onZoom이 발동해도 marker가 TDZ에 걸리지 않도록)
  const marker = document.createElement("div");
  marker.className = "gp-marker";
  marker.hidden = true;
  container.appendChild(marker);
  let _markerSpace = null; // 마커가 가리키는 현재 노드의 시뮬레이션 좌표
  let _selMarkerSpace = null; // 선택 노드 좌표 백업(호버 후 복원)

  const cosmograph = new Cosmograph(container, cfg);

  const vis = visibleData();
  cosmograph.setData(vis.nodes, vis.links);
  _instance = cosmograph;

  function positionMarker() {
    if (!state.selected || !_markerSpace) {
      marker.hidden = true;
      return;
    }
    try {
      const s = cosmograph.spaceToScreenPosition(_markerSpace);
      const r = container.getBoundingClientRect();
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > r.width || s[1] > r.height) {
        marker.hidden = true;
        return;
      }
      marker.style.left = `${s[0]}px`;
      marker.style.top = `${s[1]}px`;
      marker.hidden = false;
    } catch (e) {
      marker.hidden = true;
    }
  }
  // 노드의 시뮬레이션 좌표
  function nodeSpace(id) {
    try {
      return cosmograph.getNodePositionsMap()?.get(id) || null;
    } catch (e) {
      return null;
    }
  }
  function showMarker(node) {
    _markerSpace = nodeSpace(node.id);
    _selMarkerSpace = _markerSpace; // 선택 노드 좌표 백업(호버 후 복원용)
    positionMarker();
    // fitView 카메라 애니메이션(~500ms) 동안에도 따라오게 잠깐 추적
    let n = 0;
    const iv = setInterval(() => {
      positionMarker();
      if (++n > 12) clearInterval(iv);
    }, 60);
  }
  // 호버 노드로 마커를 임시 이동 / 복원
  function markerToHover(node) {
    const sp = nodeSpace(node.id);
    if (sp) {
      _markerSpace = sp;
      positionMarker();
    }
  }
  function markerRestore() {
    _markerSpace = _selMarkerSpace;
    positionMarker();
  }
  function hideMarker() {
    _markerSpace = null;
    _selMarkerSpace = null;
    marker.hidden = true;
  }
  window.addEventListener("resize", positionMarker);

  // 시뮬레이션은 disableSimulation으로 꺼져 있어(사전 계산 좌표 사용) 별도 정지가 필요 없다.

  // 선택 노드 + (보이는) 이웃의 이름표를 캔버스에 고정 → 뷰어에서도 설명이 보이게.
  // cosmos.setConfig는 부분 전달 시 나머지를 기본값으로 덮으므로 cfg 전체를 넘긴다.
  function setForcedLabels(nodes) {
    try {
      cosmograph.setConfig({ ...cfg, showLabelsFor: nodes });
    } catch (e) {
      /* noop */
    }
  }

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

  // 패널 항목(관련 글·태그·시리즈·결과 등) hover → 그래프 노드에 링 + 마커 임시 이동.
  // 위임(delegation) 한 번으로 모든 [data-node-id] 항목에 적용.
  sideBody.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-node-id]");
    if (!el || !sideBody.contains(el)) return;
    const node = nodesById.get(el.dataset.nodeId);
    if (!node) return;
    try {
      cosmograph.focusNode(node);
    } catch (err) {
      /* noop */
    }
    if (state.selected) markerToHover(node); // 선택 상태일 때만 마커 이동
  });
  sideBody.addEventListener("mouseout", e => {
    const el = e.target.closest("[data-node-id]");
    if (!el) return;
    try {
      cosmograph.focusNode(state.selected || undefined);
    } catch (err) {
      /* noop */
    }
    if (state.selected) markerRestore();
  });

  // 기본 브라우즈 목록 = 전체 글(최신순)
  const allPosts = data.nodes
    .filter(n => n.type === "post" && n.url)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const TYPE_ORDER = { post: 0, tag: 1, subcategory: 2, category: 3, series: 4 };
  let currentQuery = "";
  // 검색: synaptic-memory 서버(우선) → 실패/부재 시 클라이언트 BM25 폴백

  // ── 검색 엔진 (Phase 1: 텍스트 BM25) ───────────────────────────────────────
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/sonblog-astro"
  // 글 URL → graph 노드 매핑 (검색 결과를 그래프와 연결)
  const urlToNode = new Map();
  data.nodes.forEach(n => {
    if (n.type === "post" && n.url) urlToNode.set(n.url.replace(/\/$/, ""), n);
  });

  // ── synaptic-memory 검색 서버 (우선) — 없으면 클라이언트 BM25 폴백 ───────────
  const SEARCH_API = "https://search.infoedu.co.kr";
  // 성공(true)만 캐시 — 실패는 캐시하지 않아 다음 검색에 재시도(재시작/스파이크 회복).
  // 동시 호출은 진행 중 프로브를 공유해 /health 중복 호출 방지.
  let _apiOk = false;
  let _apiProbe = null;
  async function apiAvailable() {
    if (_apiOk) return true;
    if (_apiProbe) return _apiProbe;
    _apiProbe = (async () => {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 4000);
        const r = await fetch(`${SEARCH_API}/health`, { signal: c.signal });
        clearTimeout(t);
        if (r.ok) {
          _apiOk = true;
          return true;
        }
      } catch (e) {
        /* 실패 → 캐시 안 함 */
      }
      return false;
    })();
    const ok = await _apiProbe;
    _apiProbe = null;
    return ok;
  }
  async function synapticSearch(q, limit) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    try {
      const r = await fetch(
        `${SEARCH_API}/search?q=${encodeURIComponent(q)}&limit=${limit || 30}`,
        { signal: c.signal }
      );
      if (!r.ok) return null;
      const j = await r.json();
      return {
        results: Array.isArray(j.results) ? j.results : [],
        stages: j.stages || [],
        ms: j.ms,
      };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

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

  // 검색 소스·건수·속도 배지
  const metaEl = document.getElementById("gs-meta");
  function setSearchMeta(source, count, ms) {
    if (!metaEl) return;
    if (!source) {
      metaEl.hidden = true;
      return;
    }
    const label =
      source === "server"
        ? "서버 시맨틱"
        : source === "semantic"
          ? "브라우저 시맨틱"
          : "오프라인 검색";
    const dot = source === "server" || source === "semantic" ? "server" : "local";
    metaEl.innerHTML =
      `<span class="gs-dot gs-dot--${dot}"></span>` +
      `${label} · ${count}건${ms != null ? ` · ${Math.round(ms)}ms` : ""}`;
    metaEl.hidden = false;
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
  // 로드된 검색 인덱스에서 글 메타(description/readMin/category) 조회
  function docMetaFor(url) {
    try {
      return _orama?.byUrl?.get((url || "").replace(/\/$/, "")) || null;
    } catch (e) {
      return null;
    }
  }

  function buildDetailHTML(node) {
    const neighbors = (adjacency.get(node.id) || [])
      .map(id => nodesById.get(id))
      .filter(Boolean);
    return node.type === "post"
      ? buildPostDetail(node, neighbors)
      : buildTaxonomyDetail(node, neighbors);
  }

  // 포스트 상세 — 세련된 정보 위계
  function buildPostDetail(node, neighbors) {
    const doc = docMetaFor(node.url);
    const subcat = neighbors.find(n => n.type === "subcategory");
    const tags = neighbors.filter(n => n.type === "tag");
    const catLabel = doc?.category ? CATEGORY_LABELS[doc.category] || doc.category : "";

    // 헤더: 브레드크럼 → 제목 → 메타
    let header = `<div class="gp-node-header gp-node-header--post">`;
    const crumbs = [];
    if (catLabel) crumbs.push(`<span class="gp-bc">${escapeHtml(catLabel)}</span>`);
    if (subcat)
      crumbs.push(
        `<span class="gp-bc gp-bc-link" data-node-id="${escapeHtml(subcat.id)}">${escapeHtml(subcat.label)}</span>`
      );
    if (crumbs.length)
      header += `<div class="gp-breadcrumb">${crumbs.join('<span class="gp-bc-sep">›</span>')}</div>`;
    header += `<h2 class="gp-title">${escapeHtml(node.label)}</h2>`;
    const meta = [];
    if (node.date) meta.push(`<span>${escapeHtml(node.date)}</span>`);
    if (doc?.readMin) meta.push(`<span>${doc.readMin}분 읽기</span>`);
    if (node.difficulty)
      meta.push(
        `<span class="gp-meta-diff gp-meta-diff--${node.difficulty}">${escapeHtml(DIFFICULTY_LABELS[node.difficulty] || node.difficulty)}</span>`
      );
    if (meta.length)
      header += `<div class="gp-meta-line">${meta.join('<span class="gp-meta-dot">·</span>')}</div>`;
    header += `</div>`;

    let body = `<div class="gp-scroll-body">`;
    if (doc?.description)
      body += `<p class="gp-lead">${escapeHtml(doc.description)}</p>`;

    // 태그 (클릭 = 해당 태그 검색)
    if (tags.length) {
      body += `<div class="gp-section gp-section--tags"><div class="gp-tags">`;
      tags.forEach(t => {
        body += `<span class="gp-tag gp-tag--tag gp-tag-search" data-tag="${escapeHtml(t.label)}">#${escapeHtml(t.label)}</span>`;
      });
      body += `</div></div>`;
    }

    // 시리즈 이어읽기
    if (node.series) {
      const seriesNode = neighbors.find(n => n.type === "series");
      if (seriesNode) {
        const sp = (adjacency.get(seriesNode.id) || [])
          .map(id => nodesById.get(id))
          .filter(n => n && n.type === "post")
          .sort((a, b) => (a.series_order || 0) - (b.series_order || 0));
        const i = sp.findIndex(n => n.id === node.id);
        const prev = sp[i - 1];
        const next = sp[i + 1];
        if (prev || next) {
          body += `<div class="gp-section"><div class="gp-section-title">시리즈 · ${escapeHtml(node.series)}<span class="gp-section-count">${i + 1}/${sp.length}</span></div><div class="gp-series-nav">`;
          if (prev)
            body += `<span class="gp-series-link gs-nav" data-node-id="${escapeHtml(prev.id)}"><span class="gp-series-dir">← 이전</span>${escapeHtml(prev.label)}</span>`;
          if (next)
            body += `<span class="gp-series-link gs-nav" data-node-id="${escapeHtml(next.id)}"><span class="gp-series-dir">다음 →</span>${escapeHtml(next.label)}</span>`;
          body += `</div></div>`;
        }
      }
    }

    // 관련 글 (서버 시맨틱으로 비동기 채움)
    body += `<div class="gp-section"><div class="gp-section-title">관련 글</div><div id="gp-related-list" class="gp-related-loading">관련 글 찾는 중…</div></div>`;
    body += `</div>`;

    const footer = node.url
      ? `<div class="gp-panel-footer"><a class="gp-open-btn" href="${escapeHtml(node.url)}">글 읽기<svg class="gp-open-btn-icon" viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>`
      : "";
    return header + body + footer;
  }

  // 분류 노드(태그/카테고리/서브/시리즈) 상세 — 연관 포스트 중심
  function buildTaxonomyDetail(node, neighbors) {
    const typeLabel = TYPE_LABELS[node.type] || node.type;
    const posts = neighbors
      .filter(n => n.type === "post")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const others = neighbors.filter(n => n.type !== "post");

    let header = `<div class="gp-node-header gp-node-header--${node.type}">`;
    header += `<div class="gp-header-row"><div class="gp-type gp-type--${node.type}">${escapeHtml(typeLabel)}</div>`;
    header += `<span class="gp-inline-stats">${posts.length}개 글</span></div>`;
    header += `<h2 class="gp-title">${escapeHtml(node.label)}</h2></div>`;

    let body = `<div class="gp-scroll-body">`;
    if (posts.length > 0) {
      body += `<div class="gp-section"><div class="gp-section-title">이 ${escapeHtml(typeLabel)}의 글<span class="gp-section-count">${posts.length}</span></div><ul class="gp-post-list">`;
      posts.forEach(p => {
        const metaHtml = p.date
          ? `<div class="gp-post-meta"><span class="gp-post-date">${escapeHtml(p.date)}</span></div>`
          : "";
        body += `<li class="gp-post-item"><span class="gp-post-link gs-nav" data-node-id="${escapeHtml(p.id)}">${escapeHtml(p.label)}</span>${metaHtml}</li>`;
      });
      body += `</ul></div>`;
    }
    if (others.length > 0) {
      body += `<div class="gp-section"><div class="gp-section-title">연결</div><div class="gp-tags">`;
      others.forEach(n => {
        body += `<span class="gp-tag gp-tag--${n.type}" data-node-id="${escapeHtml(n.id)}">${escapeHtml(n.label)}</span>`;
      });
      body += `</div></div>`;
    }
    body += `</div>`;
    return header + body;
  }

  // 클릭 노드가 속한 토픽 클러스터(같은 community = 서브카테고리 + 형제 글 + 허브)
  function clusterNodesFor(node) {
    const out = new Map();
    const add = n => {
      if (n && activeTypes.has(n.type)) out.set(n.id, n);
    };
    add(node);
    (adjacency.get(node.id) || []).forEach(id => add(nodesById.get(id)));
    renderNodes.forEach(n => {
      if (n.community === node.community) add(n);
    });
    return [...out.values()].slice(0, 120);
  }

  // 노드 상세 보기 (그래프: 토픽 클러스터 프레이밍·강조 + 우측 패널 상세)
  function showNode(node) {
    if (!node || !sideBody) return;
    renderSeq++; // 패널 소유권 — 늦게 끝난 검색이 덮어쓰지 못하게
    state.selected = node;
    const cluster = clusterNodesFor(node);
    state.clusterNodes = cluster;
    // 클러스터의 허브(카테고리/서브카테고리) 이름 + 클릭한 노드 이름을 캔버스에 라벨
    const hubLabels = cluster.filter(n => n.type !== "post" && n.type !== "tag");
    try {
      applyHighlight(); // 클러스터 강조(나머지 흐림 — 맥락 유지)
      cosmograph.focusNode(node); // 클릭 노드에 링
      cosmograph.fitViewByNodeIds(
        cluster.map(n => n.id),
        500
      ); // 클러스터가 화면에 차도록 프레이밍(깊게 줌 안 함)
    } catch (e) {
      /* noop */
    }
    setForcedLabels([node, ...hubLabels.slice(0, 10)]);
    showMarker(node); // 그래프 노드 위 선택 핀
    sideBody.innerHTML =
      `<button type="button" class="gs-back" id="gs-back"><svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>검색으로</button>` +
      buildDetailHTML(node);
    sideBody.scrollTop = 0;
    document.getElementById("gs-back")?.addEventListener("click", () => {
      clearNode();
      renderList(currentQuery);
    });
    sideBody
      .querySelectorAll(
        ".gp-tag[data-node-id], .gs-nav[data-node-id], .gp-bc-link[data-node-id]"
      )
      .forEach(el => {
        el.addEventListener("click", () => {
          const t = nodesById.get(el.dataset.nodeId);
          if (t) showNode(t);
        });
      });
    // 태그 칩 클릭 → 해당 태그로 검색(글 모음)
    sideBody.querySelectorAll(".gp-tag-search[data-tag]").forEach(el => {
      el.addEventListener("click", () => {
        const tag = el.dataset.tag;
        if (!tag) return;
        clearNode();
        if (searchInput) searchInput.value = tag;
        renderList(tag);
        searchInput?.focus();
      });
    });
    if (node.type === "post") populateRelated(node, renderSeq);
  }

  // 공통 태그 라벨 (왜 관련인지) — 최대 3개
  function sharedTagLabels(a, b) {
    const ta = postTagSet.get(a.id);
    const tb = postTagSet.get(b.id);
    if (!ta || !tb) return [];
    const out = [];
    tb.forEach(id => {
      if (ta.has(id) && out.length < 3) {
        const n = nodesById.get(id);
        if (n) out.push(n.label);
      }
    });
    return out;
  }

  function renderRelated(seq, items) {
    if (seq !== renderSeq) return; // 그 사이 다른 노드 클릭 → 폐기
    const target = document.getElementById("gp-related-list");
    if (!target) return;
    if (!items.length) {
      target.classList.remove("gp-related-loading");
      target.textContent = "관련 글 없음";
      return;
    }
    let html = `<ul class="gp-post-list">`;
    items.forEach(it => {
      const meta = [];
      if (it.node.date) meta.push(`<span class="gp-post-date">${escapeHtml(it.node.date)}</span>`);
      if (it.why && it.why.length)
        meta.push(`<span class="gp-related-why">공통 ${escapeHtml(it.why.join(", "))}</span>`);
      const metaHtml = meta.length ? `<div class="gp-post-meta">${meta.join("")}</div>` : "";
      html += `<li class="gp-post-item"><span class="gp-post-link gs-nav" data-node-id="${escapeHtml(it.node.id)}">${escapeHtml(it.node.label)}</span>${metaHtml}</li>`;
    });
    html += `</ul>`;
    target.classList.remove("gp-related-loading");
    target.innerHTML = html;
    target.querySelectorAll(".gs-nav[data-node-id]").forEach(el => {
      el.addEventListener("click", () => {
        const t = nodesById.get(el.dataset.nodeId);
        if (t) showNode(t);
      });
    });
  }

  // 상세의 '관련 글' — 태그기반을 즉시 표시하고, 서버 시맨틱이 오면 교체(절대 안 멈춤)
  async function populateRelated(node, seq) {
    // 1) 즉시: 공통 태그 Jaccard
    const tagBased = similarPosts(node, 6).map(s => ({
      node: s.node,
      why: sharedTagLabels(node, s.node),
    }));
    renderRelated(seq, tagBased);

    // 2) 백그라운드: 서버 시맨틱으로 업그레이드(가용 시)
    try {
      if (!(await apiAvailable())) return;
      const api = await synapticSearch(node.label, 8);
      if (!api || !api.results.length || seq !== renderSeq) return;
      const selfUrl = (node.url || "").replace(/\/$/, "");
      const sem = [];
      for (const h of api.results) {
        const u = (h.url || "").replace(/\/$/, "");
        if (u === selfUrl) continue;
        const rn = urlToNode.get(u);
        if (rn) sem.push({ node: rn, why: sharedTagLabels(node, rn) });
        if (sem.length >= 6) break;
      }
      if (sem.length) renderRelated(seq, sem);
    } catch (e) {
      /* noop */
    }
  }

  // 그래프 선택 해제 (전체 노드 복원)
  // 현재 상태(선택 노드 > 검색결과 > 없음)에 맞춰 그래프 강조 적용
  function applyHighlight() {
    try {
      if (state.selected) {
        // 선택 노드의 토픽 클러스터를 강조(형제 글까지 보이게)
        if (state.clusterNodes.length) cosmograph.selectNodes(state.clusterNodes);
        else cosmograph.selectNode(state.selected, true);
      } else if (state.searchNodes.length) {
        cosmograph.selectNodes(state.searchNodes);
      } else {
        cosmograph.unselectNodes();
      }
    } catch (e) {
      /* noop */
    }
  }

  function clearNode() {
    state.selected = null;
    state.clusterNodes = [];
    hideMarker();
    try {
      cosmograph.focusNode(undefined);
    } catch (e) {
      /* noop */
    }
    setForcedLabels(labelHubs); // 라벨을 분류 허브로 복원
    applyHighlight();
  }

  // 결과 항목 렌더 (entries: {nodeId,label,type,date,snippetHtml,labelHtml})
  function renderEntries(sections) {
    let html = "";
    sections.forEach(sec => {
      if (!sec.entries.length) return;
      html += `<div class="gs-section-head">${sec.head}<span class="gs-count">${sec.count ?? sec.entries.length}</span></div><ul class="gs-list">`;
      sec.entries.forEach(e => {
        const label = e.labelHtml || escapeHtml(e.label);
        if (e.type === "post") {
          const dateStr = e.date ? `<span class="gs-item-date">${escapeHtml(e.date)}</span>` : "";
          const cat =
            e.category && CATEGORY_LABELS[e.category]
              ? `<span class="gs-cat">${escapeHtml(CATEGORY_LABELS[e.category])}</span>`
              : "";
          const meta = cat || dateStr ? `<div class="gs-item-meta">${cat}${dateStr}</div>` : "";
          const snip = e.snippetHtml ? `<div class="gs-item-snippet">${e.snippetHtml}</div>` : "";
          const rel =
            typeof e.rel === "number"
              ? `<div class="gs-rel"><span style="width:${Math.round(e.rel * 100)}%"></span></div>`
              : "";
          html +=
            `<li class="gs-item gs-item--post" data-node-id="${escapeHtml(e.nodeId)}">` +
            `<div class="gs-item-label">${label}</div>${meta}${snip}${rel}</li>`;
        } else {
          // 태그·주제 등 비포스트 노드는 컴팩트 행(타입 칩 + 라벨)
          html +=
            `<li class="gs-item gs-item--node" data-node-id="${escapeHtml(e.nodeId)}">` +
            `<span class="gt-type gt-type--${e.type}">${escapeHtml(TYPE_LABELS[e.type] || e.type)}</span>` +
            `<span class="gs-item-label gs-item-label--node">${label}</span></li>`;
        }
      });
      html += `</ul>`;
    });
    if (!html) html = `<div class="gs-section-head">검색결과<span class="gs-count">0</span></div><div class="gs-empty">결과가 없습니다</div>`;
    sideBody.innerHTML = html;
    sideBody.scrollTop = 0;
    sideBody.querySelectorAll(".gs-item").forEach(el => {
      const getNode = () => nodesById.get(el.dataset.nodeId);
      // 패널 항목 hover → 그래프에서 해당 노드 강조(링) — 양방향 연계
      el.addEventListener("mouseenter", () => {
        const node = getNode();
        if (node) {
          try {
            cosmograph.focusNode(node);
          } catch (e) {
            /* noop */
          }
        }
      });
      el.addEventListener("mouseleave", () => {
        try {
          cosmograph.focusNode(state.selected || undefined);
        } catch (e) {
          /* noop */
        }
      });
      el.addEventListener("click", () => {
        const node = getNode();
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
    const seq = ++renderSeq; // 이 렌더의 소유권 토큰
    currentQuery = query || "";
    const q = currentQuery.trim();
    if (searchClear) searchClear.style.display = q ? "flex" : "none";

    // 빈 쿼리 → 전체 글 브라우즈 + 그래프 강조 해제
    if (!q) {
      state.searchNodes = [];
      setSearchMeta(null);
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
    const mode = "text"; // 클라이언트 폴백 = BM25
    // 폴백(BM25)용 클라이언트 인덱스는 지연 로드 — synaptic 서버가 우선이라
    // ensureSearch(느린 Orama 빌드)가 /search 호출을 막지 않게 한다.
    let engine = null;

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
        category: doc.category,
        labelHtml: highlight(doc.title, ql),
        snippetHtml: highlight(snippetFor(doc, ql), ql),
      });
    };

    // synaptic-memory 서버 결과({url,title,score})를 패널 항목으로.
    // 날짜·스니펫은 클라이언트 인덱스(engine.byUrl)에서 보강.
    const pushApiHit = h => {
      if (postEntries.length >= 80) return;
      const url = (h.url || "").replace(/\/$/, "");
      const node = urlToNode.get(url);
      if (!node || seen.has(node.id)) return;
      seen.add(node.id);
      const doc = engine?.byUrl?.get(url);
      postEntries.push({
        nodeId: node.id,
        type: "post",
        date: node.date || doc?.date,
        category: doc?.category,
        score: typeof h.score === "number" ? h.score : undefined,
        labelHtml: highlight(h.title || node.label || "", ql),
        snippetHtml: highlight(doc ? snippetFor(doc, ql) : "", ql),
      });
    };

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

    // 결과 확정 렌더 (BM25/synaptic 공통) — seq/쿼리 가드 후 그래프 강조 + 패널 렌더
    const commit = (source, ms) => {
      if (reqQuery !== currentQuery || seq !== renderSeq) return;
      const maxScore = postEntries.reduce(
        (m, e) => (typeof e.score === "number" ? Math.max(m, e.score) : m),
        0
      );
      if (maxScore > 0)
        postEntries.forEach(e => {
          if (typeof e.score === "number") e.rel = Math.max(0.12, e.score / maxScore);
        });
      setSearchMeta(source, postEntries.length, ms);
      state.searchNodes = [...postEntries, ...nodeEntries]
        .map(e => nodesById.get(e.nodeId))
        .filter(Boolean);
      if (!state.selected) applyHighlight();
      renderEntries([
        { head: "글", entries: postEntries },
        { head: "태그·주제", entries: nodeEntries },
      ]);
    };

    // 1) 즉시: 클라이언트 BM25 — GPU/네트워크 무관하게 타이핑 순간 결과 표시
    try {
      engine = await ensureSearch();
    } catch (e) {
      engine = null;
    }
    if (reqQuery !== currentQuery || seq !== renderSeq) return;
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
    commit("local", null);

    // 2) 업그레이드: synaptic 서버 결과가 오면 더 좋은 의미검색으로 교체
    if (await apiAvailable()) {
      const api = await synapticSearch(q);
      if (reqQuery !== currentQuery || seq !== renderSeq) return;
      if (api && api.results.length) {
        seen.clear();
        postEntries.length = 0;
        api.results.forEach(pushApiHit);
        commit("server", api.ms);
      }
    }
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

  // ── 첫 포커스 시 검색 서버 가용성 미리 확인(폴백 빠르게 결정) ─────────────────
  let _preloaded = false;
  searchInput?.addEventListener("focus", () => {
    if (_preloaded) return;
    _preloaded = true;
    apiAvailable();
    ensureSearch().catch(() => {}); // BM25 즉시 응답 위해 Orama 인덱스 미리 로드
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

  // ── 키보드 내비게이션 (↑↓ 이동 · Enter 열기 · Esc 닫기) ─────────────────────
  function moveFocus(delta) {
    const items = [...sideBody.querySelectorAll(".gs-item")];
    if (!items.length) return;
    let idx = items.findIndex(el => el.classList.contains("is-focus"));
    idx = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : idx + delta;
    idx = Math.max(0, Math.min(items.length - 1, idx));
    items.forEach((el, i) => el.classList.toggle("is-focus", i === idx));
    items[idx].scrollIntoView({ block: "nearest" });
  }
  searchInput?.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Enter") {
      const el =
        sideBody.querySelector(".gs-item.is-focus") || sideBody.querySelector(".gs-item");
      if (el) {
        e.preventDefault();
        el.click();
      }
    } else if (e.key === "Escape") {
      if (searchInput.value) {
        searchInput.value = "";
        renderList("");
      } else if (state.selected) {
        clearNode();
        renderList(currentQuery);
      }
    }
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
