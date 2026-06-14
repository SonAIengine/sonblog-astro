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

  const state = { selected: null, hovered: null };

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
      if (node) openPanel(node);
      else closePanel();
    },
    onLabelClick: node => {
      if (node) openPanel(node);
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
      try {
        // 클릭 선택된 노드가 있으면 그 포커스를 유지, 없으면 전체 복원
        if (state.selected) cosmograph.selectNode(state.selected, true);
        else cosmograph.unselectNodes();
      } catch (e) {
        /* noop */
      }
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

  // ── 정보 패널 ───────────────────────────────────────────────────────────────
  const panel = document.getElementById("graph-info-panel");
  const panelBody = document.getElementById("graph-panel-body");
  const panelClose = document.getElementById("graph-panel-close");

  function openPanel(node) {
    if (!panel || !panelBody || !node) return;
    state.selected = node;
    try {
      cosmograph.focusNode(node);
      cosmograph.zoomToNode(node);
    } catch (e) {
      /* noop */
    }

    const typeLabel = TYPE_LABELS[node.type] || node.type;
    const neighborIds = adjacency.get(node.id) || [];
    const neighbors = neighborIds.map(id => nodesById.get(id)).filter(Boolean);

    const posts = neighbors
      .filter(n => n.type === "post")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const others = neighbors.filter(n => n.type !== "post");
    const deg = neighbors.length;

    // 헤더
    let header = `<div class="gp-node-header gp-node-header--${node.type}">`;
    header += `<div class="gp-header-row">`;
    header += `<div class="gp-type gp-type--${node.type}">${escapeHtml(typeLabel)}</div>`;
    const stats = [`${deg} 연결`];
    if (posts.length) stats.push(`${posts.length} 포스트`);
    if (others.length) stats.push(`${others.length} 노드`);
    header += `<span class="gp-inline-stats">${stats.join(" · ")}</span>`;
    header += `</div>`;
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

    // 본문
    let body = `<div class="gp-scroll-body">`;

    if (posts.length > 0) {
      body += `<div class="gp-section">`;
      body += `<div class="gp-section-title">연관 포스트<span class="gp-section-count">${posts.length}</span></div>`;
      body += `<ul class="gp-post-list">`;
      posts.forEach(p => {
        const dateStr = p.date ? `<span class="gp-post-date">${escapeHtml(p.date)}</span>` : "";
        body += `<li class="gp-post-item">`;
        body += p.url
          ? `<a href="${escapeHtml(p.url)}" class="gp-post-link">${escapeHtml(p.label)}</a>${dateStr}`
          : `<span class="gp-post-label">${escapeHtml(p.label)}</span>${dateStr}`;
        body += `</li>`;
      });
      body += `</ul></div>`;
    }

    if (others.length > 0) {
      const order = ["category", "subcategory", "series", "tag"];
      const grouped = {};
      others.forEach(n => {
        (grouped[n.type] = grouped[n.type] || []).push(n);
      });
      body += `<div class="gp-section">`;
      body += `<div class="gp-section-title">연결 노드<span class="gp-section-count">${others.length}</span></div>`;
      order.forEach(t => {
        if (!grouped[t] || !grouped[t].length) return;
        body += `<div class="gp-conn-group">`;
        body += `<span class="gp-conn-group-label gp-type--${t}">${escapeHtml(TYPE_LABELS[t])}</span>`;
        body += `<div class="gp-tags">`;
        grouped[t].forEach(n => {
          body += `<span class="gp-tag gp-tag--${n.type}" data-node-id="${escapeHtml(n.id)}">${escapeHtml(n.label)}</span>`;
        });
        body += `</div></div>`;
      });
      body += `</div>`;
    }
    body += `</div>`;

    // 푸터 (포스트면 글 읽기 버튼)
    let footer = "";
    if (node.type === "post" && node.url) {
      footer =
        `<div class="gp-panel-footer"><a class="gp-open-btn" href="${escapeHtml(node.url)}">글 읽기` +
        `<svg class="gp-open-btn-icon" viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>`;
    }

    panelBody.innerHTML = header + body + footer;
    panel.classList.add("is-open");

    // 연결 노드 칩 클릭 → 해당 노드로 이동
    panelBody.querySelectorAll(".gp-tag[data-node-id]").forEach(el => {
      el.addEventListener("click", () => {
        const target = nodesById.get(el.dataset.nodeId);
        if (target) openPanel(target);
      });
    });
  }

  function closePanel() {
    state.selected = null;
    panel?.classList.remove("is-open");
    try {
      cosmograph.focusNode(undefined);
    } catch (e) {
      /* noop */
    }
  }
  panelClose?.addEventListener("click", closePanel);

  // ── 필터 ─────────────────────────────────────────────────────────────────
  document.querySelectorAll(".graph-filter-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) activeTypes.add(cb.dataset.type);
      else activeTypes.delete(cb.dataset.type);
      const v = visibleData();
      cosmograph.setData(v.nodes, v.links);
    });
  });

  // ── 검색 ─────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById("graph-search");
  const searchClear = document.getElementById("graph-search-clear");
  const searchWrap = searchInput?.closest(".graph-search-wrap");
  let dropdown = null;

  function ensureDropdown() {
    if (!dropdown && searchWrap) {
      dropdown = document.createElement("div");
      dropdown.className = "graph-search-dropdown";
      searchWrap.appendChild(dropdown);
    }
    return dropdown;
  }

  function runSearch(q) {
    const query = q.trim().toLowerCase();
    searchClear.style.display = query ? "flex" : "none";
    const dd = ensureDropdown();
    if (!dd) return;
    if (!query) {
      dd.classList.remove("is-visible");
      dd.innerHTML = "";
      return;
    }
    const matches = data.nodes
      .filter(n => (n.label || "").toLowerCase().includes(query))
      .sort((a, b) => degreeOf(b.id) - degreeOf(a.id))
      .slice(0, 12);

    if (!matches.length) {
      dd.innerHTML = `<div class="gp-search-empty" style="padding:0.7rem 0.9rem;font-size:0.78rem;opacity:0.6">검색 결과 없음</div>`;
      dd.classList.add("is-visible");
      return;
    }
    dd.innerHTML = matches
      .map(
        n =>
          `<div class="gp-search-item" data-node-id="${escapeHtml(n.id)}" style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.8rem;cursor:pointer;font-size:0.8rem;border-bottom:1px solid var(--md-default-fg-color--lightest)">` +
          `<span class="gt-type gt-type--${n.type}" style="margin:0;flex-shrink:0">${escapeHtml(TYPE_LABELS[n.type] || n.type)}</span>` +
          `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n.label)}</span></div>`
      )
      .join("");
    dd.classList.add("is-visible");

    dd.querySelectorAll(".gp-search-item").forEach(el => {
      el.addEventListener("mousedown", e => {
        e.preventDefault();
        const node = nodesById.get(el.dataset.nodeId);
        if (!node) return;
        // 검색 대상 타입이 꺼져 있으면 켜고 데이터 갱신
        if (!activeTypes.has(node.type)) {
          activeTypes.add(node.type);
          const cb = document.querySelector(`.graph-filter-cb[data-type="${node.type}"]`);
          if (cb) cb.checked = true;
          const v = visibleData();
          cosmograph.setData(v.nodes, v.links);
        }
        dd.classList.remove("is-visible");
        searchInput.value = node.label;
        searchClear.style.display = "flex";
        setTimeout(() => openPanel(node), 60);
      });
    });
  }

  searchInput?.addEventListener("input", e => runSearch(e.target.value));
  searchInput?.addEventListener("focus", e => {
    if (e.target.value) runSearch(e.target.value);
  });
  searchInput?.addEventListener("blur", () => {
    setTimeout(() => dropdown?.classList.remove("is-visible"), 150);
  });
  searchClear?.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.style.display = "none";
    dropdown?.classList.remove("is-visible");
    searchInput.focus();
  });

  // ── 초기화 버튼 ───────────────────────────────────────────────────────────
  document.getElementById("graph-reset")?.addEventListener("click", () => {
    closePanel();
    if (searchInput) {
      searchInput.value = "";
      searchClear.style.display = "none";
    }
    dropdown?.classList.remove("is-visible");
    try {
      cosmograph.fitView(400);
    } catch (e) {
      /* noop */
    }
  });

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
