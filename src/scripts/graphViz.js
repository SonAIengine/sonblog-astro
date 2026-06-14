import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import louvain from "graphology-communities-louvain";
import { create, insert, search as oramaSearch } from "@orama/orama";

let currentRenderer = null;
let starfieldAnimId  = null;

// ── 공통 상수 ────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  category: "카테고리", subcategory: "서브카테고리",
  series: "시리즈", tag: "태그", post: "포스트",
};

const TYPE_LABELS_SHORT = {
  category: "카테고리", subcategory: "서브",
  series: "시리즈", tag: "태그", post: "포스트",
};

function getThemeColors(dark) {
  const NODE_COLORS = dark ? {
    category: "#a78bfa", subcategory: "#60a5fa",
    series: "#fb923c", tag: "#34d399", post: "#f472b6",
  } : {
    category: "#7C3AED", subcategory: "#2563EB",
    series: "#EA580C", tag: "#0D9488", post: "#DC2626",
  };

  const EDGE_COLORS = dark ? {
    inCategory: "rgba(167,139,250,0.5)", inSubcategory: "rgba(96,165,250,0.4)",
    inSeries: "rgba(251,146,60,0.55)", hasTag: "rgba(52,211,153,0.4)",
    related: "rgba(192,132,252,0.55)", dependsOn: "rgba(96,165,250,0.6)",
    tagCooccurs: "rgba(253,224,71,0.3)",
  } : {
    inCategory: "#9333ea", inSubcategory: "#3b82f6",
    inSeries: "#ea580c", hasTag: "#0d9488",
    related: "#8b5cf6", dependsOn: "#2563eb",
    tagCooccurs: "#94a3b8",
  };

  return {
    NODE_COLORS,
    EDGE_COLORS,
    LABEL_COLOR:  dark ? "#e2e8f0" : "#1a1a2e",
    LABEL_BG:     dark ? "rgba(7,11,24,0.7)" : "rgba(255,255,255,0)",
    DEFAULT_EDGE: dark ? "rgba(148,163,184,0.25)" : "#94a3b8",
  };
}

// ── 다크모드 감지 ────────────────────────────────────────────────────────────

function isDarkMode() {
  return document.documentElement.getAttribute("data-md-color-scheme") === "slate";
}

// ── 별 파티클 배경 (다크모드 전용) ──────────────────────────────────────────

function startStarfield(container) {
  const old = container.querySelector(".starfield-canvas");
  if (old) old.remove();
  if (starfieldAnimId) { cancelAnimationFrame(starfieldAnimId); starfieldAnimId = null; }

  const canvas = document.createElement("canvas");
  canvas.className = "starfield-canvas";
  canvas.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 0;
  `;
  container.style.position = "relative";
  container.prepend(canvas);

  function resize() {
    canvas.width  = container.offsetWidth  || 800;
    canvas.height = container.offsetHeight || 600;
  }
  resize();

  const ctx = canvas.getContext("2d");

  const stars = Array.from({ length: 200 }, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height,
    r:  Math.random() * 1.2 + 0.2,
    alpha: Math.random() * 0.6 + 0.2,
    dAlpha: (Math.random() * 0.005 + 0.001) * (Math.random() < 0.5 ? 1 : -1),
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.alpha += s.dAlpha;
      if (s.alpha > 0.85 || s.alpha < 0.1) s.dAlpha *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 200, 255, ${s.alpha})`;
      ctx.fill();
    });
    starfieldAnimId = requestAnimationFrame(draw);
  }

  draw();

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  canvas._ro = ro;
}

function stopStarfield(container) {
  if (starfieldAnimId) { cancelAnimationFrame(starfieldAnimId); starfieldAnimId = null; }
  const c = container?.querySelector(".starfield-canvas");
  if (c) { c._ro?.disconnect(); c.remove(); }
}

// ── 그래프 구성 ──────────────────────────────────────────────────────────────

function buildGraph(rawData, colors) {
  const { NODE_COLORS, EDGE_COLORS, DEFAULT_EDGE } = colors;

  const NODE_HIDDEN_BY_TYPE = {
    category: false, subcategory: false,
    series: false, tag: false, post: true,
  };

  // 연결 수 계산
  const degreeMap = {};
  rawData.nodes.forEach(n => { degreeMap[n.id] = 0; });
  rawData.edges.forEach(e => {
    if (degreeMap[e.source] !== undefined) degreeMap[e.source]++;
    if (degreeMap[e.target] !== undefined) degreeMap[e.target]++;
  });

  function computeNodeSize(node) {
    const deg = degreeMap[node.id] || 0;
    switch (node.type) {
      case "category":    return 28;
      case "subcategory": return 16 + Math.min(deg * 0.3, 7);
      case "tag":         return Math.max(7, Math.min(18, 6 + deg * 0.8));
      case "series":      return Math.max(10, Math.min(22, 10 + deg * 0.4));
      case "post":        return Math.max(6, Math.min(16, 5 + deg * 1.5));
      default:            return 8;
    }
  }

  const graph = new Graph({ multi: false, type: "directed" });

  rawData.nodes.forEach(node => {
    graph.addNode(node.id, {
      label:      node.label,
      size:       computeNodeSize(node),
      color:      NODE_COLORS[node.type] || "#a78bfa",
      nodeType:   node.type,
      url:        node.url        || null,
      date:       node.date       || null,
      series:     node.series     || null,
      difficulty: node.difficulty || null,
      hidden:     NODE_HIDDEN_BY_TYPE[node.type] ?? false,
      x: Math.random() * 100,
      y: Math.random() * 100,
    });
  });

  const edgeSet = new Set();
  rawData.edges.forEach(edge => {
    const key    = `${edge.source}--${edge.target}`;
    const revKey = `${edge.target}--${edge.source}`;
    if (
      edgeSet.has(key) || edgeSet.has(revKey) ||
      !graph.hasNode(edge.source) || !graph.hasNode(edge.target) ||
      edge.source === edge.target
    ) return;
    edgeSet.add(key);

    const isDirected = edge.type === "dependsOn" || edge.type === "related";
    graph.addDirectedEdge(edge.source, edge.target, {
      edgeType: edge.type,
      weight:   edge.weight,
      color:    EDGE_COLORS[edge.type] || DEFAULT_EDGE,
      size:     edge.type === "tagCooccurs" ? Math.min(edge.weight * 0.5, 2.0) : 1.2,
      type:     isDirected ? "arrow" : "line",
    });
  });

  return graph;
}

// ── 레이아웃: Louvain 커뮤니티 시딩 + ForceAtlas2 ────────────────────────────

function computeLayout(graph) {
  // Louvain은 undirected 그래프가 필요 → 임시 복사본 생성
  const undirectedGraph = new Graph({ multi: false, type: "undirected" });
  graph.forEachNode((node, attrs) => {
    undirectedGraph.addNode(node, { weight: attrs.size || 1 });
  });
  graph.forEachEdge((_edge, attrs, source, target) => {
    if (source !== target && !undirectedGraph.hasEdge(source, target)) {
      undirectedGraph.addEdge(source, target, { weight: attrs.weight || 1 });
    }
  });

  // Louvain 커뮤니티 감지
  const communities = louvain(undirectedGraph, {
    resolution: 1.2,
    getEdgeWeight: "weight",
  });

  // 커뮤니티별 노드 그룹핑
  const communityNodes = {};
  Object.entries(communities).forEach(([node, comm]) => {
    if (!communityNodes[comm]) communityNodes[comm] = [];
    communityNodes[comm].push(node);
    if (graph.hasNode(node)) graph.setNodeAttribute(node, "community", comm);
  });

  // 커뮤니티 중심점 배치 (원형)
  const numCommunities = Object.keys(communityNodes).length;
  const COMMUNITY_RADIUS = 300;
  const commCenters = {};
  Object.keys(communityNodes).forEach((comm, i) => {
    const angle = (i / numCommunities) * 2 * Math.PI;
    commCenters[comm] = {
      x: COMMUNITY_RADIUS * Math.cos(angle),
      y: COMMUNITY_RADIUS * Math.sin(angle),
    };
  });

  // 각 노드를 자기 커뮤니티 중심 주변에 배치
  const catNodes = graph.nodes().filter(n => graph.getNodeAttribute(n, "nodeType") === "category");

  graph.forEachNode((node) => {
    const comm = communities[node];
    const center = commCenters[comm] || { x: 0, y: 0 };
    const communitySize = communityNodes[comm]?.length || 1;
    const jitterRadius = Math.min(150, 30 + Math.sqrt(communitySize) * 15);

    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * jitterRadius;

    graph.setNodeAttribute(node, "x", center.x + dist * Math.cos(angle));
    graph.setNodeAttribute(node, "y", center.y + dist * Math.sin(angle));
  });

  // category 노드는 커뮤니티 중심에 고정 (앵커)
  catNodes.forEach((n) => {
    const comm = communities[n];
    if (comm !== undefined && commCenters[comm]) {
      graph.setNodeAttribute(n, "x", commCenters[comm].x);
      graph.setNodeAttribute(n, "y", commCenters[comm].y);
    }
  });

  // ForceAtlas2 시뮬레이션
  forceAtlas2.assign(graph, {
    iterations: 300,
    settings: {
      gravity:                        0.05,
      scalingRatio:                   10,
      barnesHutOptimize:              true,
      barnesHutTheta:                 0.5,
      strongGravityMode:              true,
      linLogMode:                     false,
      outboundAttractionDistribution: true,
      adjustSizes:                    false,
      edgeWeightInfluence:            1,
      slowDown:                       1,
    },
  });
}

// ── Sigma 렌더러 생성 ────────────────────────────────────────────────────────

function createRenderer(graph, container, colors, dark, graphState) {
  const { NODE_COLORS, EDGE_COLORS, LABEL_COLOR, LABEL_BG, DEFAULT_EDGE } = colors;

  return new Sigma(graph, container, {
    renderEdgeLabels:           false,
    enableEdgeClickEvents:      false,
    enableEdgeWheelEvents:      false,
    enableEdgeHoverEvents:      false,
    defaultNodeColor:           NODE_COLORS.tag,
    defaultEdgeColor:           DEFAULT_EDGE,
    labelFont:                  "Pretendard, sans-serif",
    labelSize:                  12,
    labelWeight:                "600",
    labelColor:                 { color: LABEL_COLOR },
    labelBackgroundColor:       LABEL_BG,
    labelRenderedSizeThreshold: 10,
    minCameraRatio:             0.03,
    maxCameraRatio:             8,
    defaultEdgeType:            "line",
    defaultArrowHeadLength:     10,

    nodeReducer: (node, data) => {
      const res = { ...data };
      const isSelected = graphState.selectedNode === node;
      const isHovered  = graphState.hoveredNode  === node;
      const neighbors  = graphState.hoveredNode
        ? new Set(graph.neighbors(graphState.hoveredNode))
        : (graphState.selectedNode ? new Set(graph.neighbors(graphState.selectedNode)) : null);

      const nodeType = data.nodeType;
      if (nodeType === "post" || nodeType === "tag") {
        res.borderColor = dark
          ? (nodeType === "post" ? "rgba(244,114,182,0.6)" : "rgba(52,211,153,0.5)")
          : (nodeType === "post" ? "rgba(220,38,38,0.5)"   : "rgba(13,148,136,0.45)");
        res.borderSize = 1.5;
      }

      if (graphState.searchQuery && graphState.searchMatches.size > 0) {
        if (!graphState.searchMatches.has(node)) {
          res.color = dark ? "#1e293b" : "#cbd5e1";
          res.label = "";
          res.size  = data.size * 0.4;
          res.borderSize = 0;
          return res;
        }
        res.size = data.size * 1.3;
        res.borderColor = dark ? "#fbbf24" : "#d97706";
        res.borderSize  = 2.5;
      }

      if ((graphState.hoveredNode || graphState.selectedNode) && !isHovered && !isSelected) {
        if (!neighbors || !neighbors.has(node)) {
          if (data.hidden) return res;
          res.color = dark ? "#374151" : "#b0bec5";
          res.label = "";
          res.size  = data.size * 0.7;
          res.borderSize = 0;
          return res;
        }
        res.size = data.size * 1.1;
      }

      if (isHovered) {
        res.borderColor = dark ? "#f8fafc" : "#1e293b";
        res.borderSize  = 2;
      }

      if (isSelected) {
        res.size        = data.size * 1.6;
        res.zIndex      = 10;
        res.borderColor = dark ? "#fbbf24" : "#b45309";
        res.borderSize  = 3;
      }

      return res;
    },

    edgeReducer: (edge, data) => {
      const res = { ...data };
      if (data.hidden) return res;

      const [src, tgt] = graph.extremities(edge);
      const active = graphState.hoveredNode || graphState.selectedNode;

      if (active) {
        if (src !== active && tgt !== active) {
          res.color = dark ? "#1e293b" : "#d1d5db";
          res.size  = 0.3;
        } else {
          res.size  = (data.size || 1) * 2.5;
          res.color = EDGE_COLORS[data.edgeType] || DEFAULT_EDGE;
        }
      }

      if (graphState.searchQuery && graphState.searchMatches.size > 0) {
        if (!graphState.searchMatches.has(src) && !graphState.searchMatches.has(tgt)) {
          res.color = dark ? "#1e293b" : "#d1d5db";
          res.size  = 0.2;
        }
      }

      return res;
    },
  });
}

// ── 툴팁 ─────────────────────────────────────────────────────────────────────

function setupTooltip(graph, container, graphState) {
  const tooltip = document.getElementById("graph-tooltip");

  function showTooltip(node, attrs, event) {
    if (!tooltip) return;
    const typeLabel = TYPE_LABELS[attrs.nodeType] || attrs.nodeType;
    const deg = graph.degree(node);
    let html = `<div class="gt-type gt-type--${attrs.nodeType}">${typeLabel}</div>`;
    html += `<div class="gt-label">${attrs.label}</div>`;
    if (attrs.date) html += `<div class="gt-meta">${attrs.date}</div>`;
    html += `<div class="gt-meta">연결 ${deg}개</div>`;
    html += `<div class="gt-hint">${attrs.nodeType === "post" ? "클릭하여 열기" : "클릭하여 상세 보기"}</div>`;

    tooltip.innerHTML = html;
    tooltip.classList.add("is-visible");
    positionTooltip(event);
  }

  function hideTooltip() { tooltip?.classList.remove("is-visible"); }

  function positionTooltip(e) {
    if (!tooltip || !e) return;
    const rect = container.getBoundingClientRect();
    const x  = (e.original?.clientX ?? e.clientX ?? 0) - rect.left;
    const y  = (e.original?.clientY ?? e.clientY ?? 0) - rect.top;
    const tw = tooltip.offsetWidth  || 200;
    const th = tooltip.offsetHeight || 80;
    tooltip.style.left = (x + 16 + tw > rect.width  ? x - tw - 8 : x + 16) + "px";
    tooltip.style.top  = (y + 16 + th > rect.height ? y - th - 8 : y + 12) + "px";
  }

  container.addEventListener("mousemove", e => {
    if (graphState.hoveredNode && tooltip?.classList.contains("is-visible")) {
      positionTooltip({ clientX: e.clientX, clientY: e.clientY });
    }
  });

  return { showTooltip, hideTooltip };
}

// ── 정보 패널 ────────────────────────────────────────────────────────────────

function setupPanel(graph, renderer, graphState, nodeContentMap, zoomToNode) {
  const panel      = document.getElementById("graph-info-panel");
  const panelBody  = document.getElementById("graph-panel-body");
  const panelClose = document.getElementById("graph-panel-close");
  const base       = document.querySelector('meta[name="site-url"]')?.content || "/";

  function openPanel(node, attrs) {
    if (!panel || !panelBody) return;
    graphState.selectedNode = node;

    const typeLabel = TYPE_LABELS[attrs.nodeType] || attrs.nodeType;
    const neighbors = graph.neighbors(node);

    const posts = neighbors
      .filter(n => graph.getNodeAttribute(n, "nodeType") === "post")
      .map(n => ({
        id:    n,
        label: graph.getNodeAttribute(n, "label"),
        url:   graph.getNodeAttribute(n, "url"),
        date:  graph.getNodeAttribute(n, "date"),
      }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const otherNeighbors = neighbors
      .filter(n => graph.getNodeAttribute(n, "nodeType") !== "post")
      .map(n => ({
        id:    n,
        label: graph.getNodeAttribute(n, "label"),
        type:  graph.getNodeAttribute(n, "nodeType"),
      }));

    const deg = graph.degree(node);

    // 헤더
    let headerHtml = `<div class="gp-node-header gp-node-header--${attrs.nodeType}">`;
    headerHtml += `<div class="gp-header-row">`;
    headerHtml += `<div class="gp-type gp-type--${attrs.nodeType}">${typeLabel}</div>`;
    const stats = [`${deg} 연결`];
    if (posts.length) stats.push(`${posts.length} 포스트`);
    if (otherNeighbors.length) stats.push(`${otherNeighbors.length} 노드`);
    headerHtml += `<span class="gp-inline-stats">${stats.join(" · ")}</span>`;
    headerHtml += `</div>`;
    headerHtml += `<h2 class="gp-title">${attrs.label}</h2>`;
    const metaParts = [];
    if (attrs.series) metaParts.push(`<span class="gp-meta-series">${attrs.series}</span>`);
    if (attrs.date) metaParts.push(`<span class="gp-meta-date">${attrs.date}</span>`);
    if (attrs.difficulty) {
      const diff = { beginner: "입문", intermediate: "중급", advanced: "고급" }[attrs.difficulty] || attrs.difficulty;
      metaParts.push(`<span class="gp-meta-diff gp-meta-diff--${attrs.difficulty}">${diff}</span>`);
    }
    if (metaParts.length) headerHtml += `<div class="gp-meta-line">${metaParts.join("")}</div>`;
    headerHtml += `</div>`;

    // 본문
    let bodyHtml = `<div class="gp-scroll-body">`;

    if (attrs.nodeType === "post") {
      const rawTeaser = (nodeContentMap[node] || "").trim();
      if (rawTeaser) {
        const teaser = rawTeaser.slice(0, 220);
        bodyHtml += `<div class="gp-section gp-section--teaser">`;
        bodyHtml += `<p class="gp-post-teaser">${teaser}${rawTeaser.length > 220 ? "..." : ""}</p>`;
        bodyHtml += `</div>`;
      }
    }

    if (posts.length > 0) {
      bodyHtml += `<div class="gp-section">`;
      bodyHtml += `<div class="gp-section-title">연관 포스트<span class="gp-section-count">${posts.length}</span></div>`;
      bodyHtml += `<ul class="gp-post-list">`;
      posts.forEach(p => {
        const dateStr = p.date ? `<span class="gp-post-date">${p.date}</span>` : "";
        bodyHtml += `<li class="gp-post-item">`;
        bodyHtml += p.url
          ? `<a href="${base}${p.url}" class="gp-post-link">${p.label}</a>${dateStr}`
          : `<span class="gp-post-label">${p.label}</span>${dateStr}`;
        bodyHtml += `</li>`;
      });
      bodyHtml += `</ul></div>`;
    }

    if (otherNeighbors.length > 0) {
      const typeOrder = ["category", "subcategory", "series", "tag"];
      const grouped = {};
      otherNeighbors.forEach(n => {
        if (!grouped[n.type]) grouped[n.type] = [];
        grouped[n.type].push(n);
      });

      bodyHtml += `<div class="gp-section">`;
      bodyHtml += `<div class="gp-section-title">연결 노드<span class="gp-section-count">${otherNeighbors.length}</span></div>`;
      typeOrder.forEach(t => {
        if (!grouped[t] || grouped[t].length === 0) return;
        bodyHtml += `<div class="gp-conn-group">`;
        bodyHtml += `<span class="gp-conn-group-label gp-type--${t}">${TYPE_LABELS[t]}</span>`;
        bodyHtml += `<div class="gp-tags">`;
        grouped[t].forEach(n => {
          bodyHtml += `<span class="gp-tag gp-tag--${n.type}" data-node-id="${n.id}">${n.label}</span>`;
        });
        bodyHtml += `</div></div>`;
      });
      bodyHtml += `</div>`;
    }

    bodyHtml += `</div>`;

    // 푸터
    let footerHtml = "";
    if (attrs.nodeType === "post" && attrs.url) {
      footerHtml = `<div class="gp-panel-footer"><a class="gp-open-btn" href="${base}${attrs.url}">글 읽기<svg class="gp-open-btn-icon" viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>`;
    }

    panelBody.innerHTML = headerHtml + bodyHtml + footerHtml;
    panel.classList.add("is-open");

    panelBody.querySelectorAll(".gp-tag[data-node-id]").forEach(el => {
      el.addEventListener("click", () => {
        const nid = el.dataset.nodeId;
        if (graph.hasNode(nid)) {
          zoomToNode(nid);
          openPanel(nid, graph.getNodeAttributes(nid));
        }
      });
    });

    renderer.refresh();
  }

  function closePanel() {
    panel?.classList.remove("is-open");
    graphState.selectedNode = null;
    renderer.refresh();
  }

  panelClose?.addEventListener("click", closePanel);

  return { openPanel, closePanel };
}

// ── 필터 ─────────────────────────────────────────────────────────────────────

function setupFilters(graph, renderer) {
  const activeFilters = {
    category: true, subcategory: true,
    series: true, tag: true, post: false,
  };

  function applyFilters() {
    graph.nodes().forEach(n => {
      graph.setNodeAttribute(n, "hidden", !activeFilters[graph.getNodeAttribute(n, "nodeType")]);
    });
    graph.edges().forEach(e => {
      const [src, tgt] = graph.extremities(e);
      const hidden = graph.getNodeAttribute(src, "hidden") || graph.getNodeAttribute(tgt, "hidden");
      graph.setEdgeAttribute(e, "hidden", hidden);
    });
    renderer.refresh();
  }

  document.querySelectorAll(".graph-filter-cb").forEach(cb => {
    const type = cb.dataset.type;
    cb.checked = activeFilters[type] ?? false;
    cb.addEventListener("change", e => {
      activeFilters[type] = e.target.checked;
      applyFilters();
    });
  });

  applyFilters();
}

// ── 검색 (Orama BM25) ───────────────────────────────────────────────────────

function setupSearch(graph, renderer, graphState, nodeContentMap) {
  let oramaDb = null;
  let oramaReady = false;

  // 노드 → 연결된 태그 라벨 매핑
  const nodeTagLabels = {};
  graph.nodes().forEach(n => {
    if (graph.getNodeAttribute(n, "nodeType") === "post") {
      const tags = graph.neighbors(n)
        .filter(nb => graph.getNodeAttribute(nb, "nodeType") === "tag")
        .map(nb => graph.getNodeAttribute(nb, "label"));
      nodeTagLabels[n] = tags.join(" ");
    }
  });

  const siteBase = document.querySelector('meta[name="site-url"]')?.content || "/sonblog/";

  function stripHtml(str) {
    if (!str) return "";
    return str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  // 비동기 인덱스 구축
  (async function buildOramaIndex() {
    try {
      let urlToText = {};
      try {
        const resp = await fetch(siteBase + "search/search_index.json");
        const searchData = await resp.json();
        searchData.docs.forEach(d => {
          const loc = (d.location || "").split("#")[0];
          if (!loc) return;
          if (!urlToText[loc]) urlToText[loc] = "";
          urlToText[loc] += " " + stripHtml(d.text || "");
        });
      } catch (e) {
        console.warn("graph-viz: search_index.json 로드 실패, label만으로 인덱스 구축", e);
      }

      graph.nodes().forEach(n => {
        const a = graph.getNodeAttributes(n);
        if (a.nodeType === "post" && a.url) {
          const cleanUrl = (a.url || "").replace(/^\//, "").replace(/^sonblog\//, "");
          nodeContentMap[n] = (urlToText[cleanUrl] || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
      });

      oramaDb = create({
        schema: {
          nodeId: "string", label: "string", nodeType: "string",
          content: "string", tags: "string", series: "string",
        },
      });

      for (const n of graph.nodes()) {
        const attrs = graph.getNodeAttributes(n);
        let content = "";
        if (attrs.nodeType === "post" && attrs.url) {
          const cleanUrl = (attrs.url || "").replace(/^\//, "").replace(/^sonblog\//, "");
          content = (urlToText[cleanUrl] || "").trim().slice(0, 2000);
        }
        insert(oramaDb, {
          nodeId: n, label: attrs.label || "", nodeType: attrs.nodeType || "",
          content, tags: nodeTagLabels[n] || "", series: attrs.series || "",
        });
      }

      oramaReady = true;
      console.log("graph-viz: Orama BM25 인덱스 준비 완료 (" + graph.order + " nodes)");
    } catch (e) {
      console.error("graph-viz: Orama 인덱스 구축 실패", e);
    }
  })();

  // 검색 UI
  const searchInput = document.getElementById("graph-search");
  const searchClear = document.getElementById("graph-search-clear");

  function doSearch(q) {
    graphState.searchQuery = q;
    graphState.searchMatches.clear();

    if (q && oramaReady && oramaDb) {
      const results = oramaSearch(oramaDb, {
        term: q, limit: 20,
        boost: { label: 3, tags: 2, series: 1.5, content: 1 },
      });
      results.hits.forEach(hit => {
        const nodeId = hit.document.nodeId;
        if (graph.hasNode(nodeId)) graphState.searchMatches.add(nodeId);
      });
      renderSearchDropdown(results.hits);
    } else if (q && !oramaReady) {
      const ql = q.toLowerCase();
      graph.nodes().forEach(n => {
        if ((graph.getNodeAttribute(n, "label") || "").toLowerCase().includes(ql)) {
          graphState.searchMatches.add(n);
        }
      });
      renderSearchDropdown(null);
    } else {
      hideSearchDropdown();
    }

    if (searchClear) searchClear.style.display = q ? "flex" : "none";
    renderer.refresh();
  }

  function renderSearchDropdown(hits) {
    let dropdown = document.getElementById("graph-search-dropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.id = "graph-search-dropdown";
      dropdown.className = "graph-search-dropdown";
      const wrap = document.querySelector(".graph-search-wrap");
      if (wrap) wrap.appendChild(dropdown);
    }

    if (hits === null) {
      const items = [...graphState.searchMatches].slice(0, 10);
      if (items.length === 0) {
        dropdown.innerHTML = '<div class="gsd-empty">결과 없음</div>';
        dropdown.classList.add("is-visible");
        return;
      }
      dropdown.innerHTML = items.map(nid => {
        const attrs = graph.getNodeAttributes(nid);
        return `<div class="gsd-item" data-node-id="${nid}">
          <span class="gsd-type gsd-type--${attrs.nodeType}">${TYPE_LABELS_SHORT[attrs.nodeType] || attrs.nodeType}</span>
          <span class="gsd-label">${attrs.label}</span>
        </div>`;
      }).join("");
      dropdown.classList.add("is-visible");
      bindDropdownClicks(dropdown);
      return;
    }

    if (!hits || hits.length === 0) {
      dropdown.innerHTML = '<div class="gsd-empty">결과 없음</div>';
      dropdown.classList.add("is-visible");
      return;
    }

    dropdown.innerHTML = hits.slice(0, 10).map(hit => {
      const doc = hit.document;
      const attrs = graph.hasNode(doc.nodeId) ? graph.getNodeAttributes(doc.nodeId) : {};
      const deg = graph.hasNode(doc.nodeId) ? graph.degree(doc.nodeId) : 0;

      let metaHtml = "";
      if (doc.nodeType === "post") {
        const parts = [];
        if (attrs.date) parts.push(attrs.date);
        if (attrs.series) parts.push(attrs.series);
        if (parts.length) metaHtml += `<span class="gsd-meta">${parts.join(" · ")}</span>`;
        if (doc.content) {
          const teaser = doc.content.slice(0, 80).replace(/\s+/g, " ").trim();
          metaHtml += `<span class="gsd-teaser">${teaser}${doc.content.length > 80 ? "..." : ""}</span>`;
        }
        if (doc.tags) {
          const tagList = doc.tags.split(" ").filter(Boolean).slice(0, 5);
          if (tagList.length) {
            metaHtml += `<span class="gsd-tags">${tagList.map(t => `<span class="gsd-tag">${t}</span>`).join("")}</span>`;
          }
        }
      } else {
        metaHtml += `<span class="gsd-meta">${deg}개 연결</span>`;
      }

      return `<div class="gsd-item" data-node-id="${doc.nodeId}">
        <div class="gsd-item-head">
          <span class="gsd-type gsd-type--${doc.nodeType}">${TYPE_LABELS_SHORT[doc.nodeType] || doc.nodeType}</span>
          <span class="gsd-label">${doc.label}</span>
        </div>
        ${metaHtml ? `<div class="gsd-item-body">${metaHtml}</div>` : ""}
      </div>`;
    }).join("");

    dropdown.classList.add("is-visible");
    bindDropdownClicks(dropdown);
  }

  function bindDropdownClicks(dropdown) {
    dropdown.querySelectorAll(".gsd-item").forEach(el => {
      el.addEventListener("click", () => {
        const nid = el.dataset.nodeId;
        if (graph.hasNode(nid)) {
          graphState.zoomToNode(nid);
          graphState.openPanel(nid, graph.getNodeAttributes(nid));
        }
        hideSearchDropdown();
      });
    });
  }

  function hideSearchDropdown() {
    const dd = document.getElementById("graph-search-dropdown");
    if (dd) dd.classList.remove("is-visible");
  }

  let searchTimer = null;
  searchInput?.addEventListener("input", e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => doSearch(q), 120);
  });

  if (searchClear) {
    searchClear.style.display = "none";
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      doSearch("");
      hideSearchDropdown();
    });
  }

  document.addEventListener("click", e => {
    if (!e.target.closest(".graph-search-wrap")) hideSearchDropdown();
  });

  return { hideSearchDropdown };
}

// ── 초기화 (오케스트레이터) ──────────────────────────────────────────────────

function init() {
  const container = document.getElementById("sigma-container");
  if (!container) return;

  const rawData = window.__GRAPH_DATA__;
  if (!rawData) { console.error("graph-viz: __GRAPH_DATA__ not found"); return; }

  if (currentRenderer) {
    try { currentRenderer.kill(); } catch (_) {}
    currentRenderer = null;
  }
  stopStarfield(container);
  container.innerHTML = "";

  const dark   = isDarkMode();
  const colors = getThemeColors(dark);

  // 1. 그래프 구성
  const graph = buildGraph(rawData, colors);

  // 2. 레이아웃 계산
  computeLayout(graph);

  // 3. 별 파티클 (다크모드)
  if (dark) startStarfield(container);

  // 4. 공유 상태
  const graphState = {
    hoveredNode: null, selectedNode: null,
    searchQuery: "", searchMatches: new Set(),
    zoomToNode: null, openPanel: null,
  };

  // 5. Sigma 렌더러
  const renderer = createRenderer(graph, container, colors, dark, graphState);

  // 6. 줌 헬퍼
  function zoomToNode(nodeId) {
    if (!graph.hasNode(nodeId)) return;
    const x = graph.getNodeAttribute(nodeId, "x");
    const y = graph.getNodeAttribute(nodeId, "y");
    if (x == null || y == null) return;
    const { x: cx, y: cy } = renderer.graphToViewport({ x, y });
    const cam = renderer.getCamera();
    cam.animate(
      renderer.viewportToFramedGraph({ x: cx, y: cy }),
      { duration: 500 }
    );
  }

  // 7. 각 기능 셋업
  const nodeContentMap = {};
  const { showTooltip, hideTooltip } = setupTooltip(graph, container, graphState);
  const { openPanel, closePanel }    = setupPanel(graph, renderer, graphState, nodeContentMap, zoomToNode);

  // graphState에 함수 참조 등록 (검색 드롭다운에서 사용)
  graphState.zoomToNode = zoomToNode;
  graphState.openPanel  = openPanel;

  setupFilters(graph, renderer);
  const { hideSearchDropdown } = setupSearch(graph, renderer, graphState, nodeContentMap);

  // 8. 이벤트 바인딩
  renderer.on("clickNode", ({ node }) => {
    hideTooltip();
    openPanel(node, graph.getNodeAttributes(node));
  });

  renderer.on("clickStage", () => { closePanel(); hideTooltip(); hideSearchDropdown(); });

  renderer.on("enterNode", ({ node, event }) => {
    graphState.hoveredNode = node;
    container.style.cursor = "pointer";
    showTooltip(node, graph.getNodeAttributes(node), event);
    renderer.refresh();
  });

  renderer.on("leaveNode", () => {
    graphState.hoveredNode = null;
    container.style.cursor = "default";
    hideTooltip();
    renderer.refresh();
  });

  // 9. 리셋 / 통계
  document.getElementById("graph-reset")?.addEventListener("click", () => {
    renderer.getCamera().animatedReset();
  });

  const statsEl = document.getElementById("graph-stats");
  if (statsEl) {
    const m = rawData.metadata || {};
    statsEl.textContent = `${m.total_posts || 0} posts · ${m.total_tags || 0} tags · ${m.total_categories || 0} categories`;
  }

  currentRenderer = renderer;
  console.log(`graph-viz: ${graph.order} nodes, ${graph.size} edges [${dark ? "dark" : "light"}]`);
}

window.initGraphViz = init;
