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

// 다크/라이트에 따른 캔버스 색상
function themeColors(dark) {
  return dark
    ? {
        background: "#070b18",
        link: "rgba(150, 170, 210, 0.16)",
        label: "#c8d6e8",
        hoverRing: "#a78bfa",
      }
    : {
        background: "#ffffff",
        link: "rgba(20, 30, 60, 0.10)",
        label: "#1f2937",
        hoverRing: "#0f766e",
      };
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

  // 현재 활성 타입에 맞는 노드/엣지 부분집합
  function visibleData() {
    const visNodes = renderNodes.filter(n => activeTypes.has(n.type));
    const visIds = new Set(visNodes.map(n => n.id));
    const visEdges = data.edges.filter(e => visIds.has(e.source) && visIds.has(e.target));
    return { nodes: visNodes, links: visEdges };
  }

  let colors = themeColors(isDarkMode());

  // ── Cosmograph 인스턴스 ─────────────────────────────────────────────────────
  const cosmograph = new Cosmograph(container, {
    backgroundColor: colors.background,
    nodeColor: n => n.color || "#888",
    nodeSize: n => Math.max(2, (n.size || 8) * 0.45),
    nodeSizeScale: 1,
    nodeGreyoutOpacity: 0.08,

    renderLinks: true,
    linkColor: () => colors.link,
    linkWidth: 0.35,
    linkWidthScale: 1,
    linkGreyoutOpacity: 0,
    curvedLinks: false,

    showDynamicLabels: true,
    showHoveredNodeLabel: true,
    nodeLabelAccessor: n => n.label || n.id,
    nodeLabelColor: colors.label,
    hoveredNodeLabelColor: colors.label,

    renderHoveredNodeRing: true,
    hoveredNodeRingColor: colors.hoverRing,
    focusedNodeRingColor: colors.hoverRing,

    // 시뮬레이션 (knowledge graph용 부드러운 분산)
    simulationGravity: 0.25,
    simulationCenter: 0.4,
    simulationRepulsion: 1.0,
    simulationLinkSpring: 1.0,
    simulationLinkDistance: 8,
    simulationFriction: 0.85,
    simulationDecay: 1500,

    fitViewOnInit: true,
    fitViewDelay: 1200,
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
    },
    onNodeMouseOut: () => {
      state.hovered = null;
      container.style.cursor = "default";
      hideTooltip();
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

  // ── 테마 변경 동기화 ──────────────────────────────────────────────────────
  syncMdScheme();
  const themeObserver = new MutationObserver(() => {
    syncMdScheme();
    colors = themeColors(isDarkMode());
    try {
      cosmograph.setConfig({
        backgroundColor: colors.background,
        linkColor: () => colors.link,
        nodeLabelColor: colors.label,
        hoveredNodeLabelColor: colors.label,
        hoveredNodeRingColor: colors.hoverRing,
        focusedNodeRingColor: colors.hoverRing,
      });
    } catch (e) {
      /* noop */
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
};

// 기존 graph.astro CSS가 [data-md-color-scheme="slate"]에 의존하므로
// Astro의 data-theme를 MkDocs 스킴 속성으로 미러링한다.
function syncMdScheme() {
  const dark = isDarkMode();
  document.documentElement.setAttribute("data-md-color-scheme", dark ? "slate" : "default");
}
