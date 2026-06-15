// graph-data.json의 각 노드에 x/y 좌표를 빌드 타임에 구워넣는다.
//
// 기존엔 모든 노드 x/y가 0이라, 클라이언트(graphViz.js)가 페이지 열 때마다
// 941노드 / 3005엣지 force simulation을 처음부터 돌려 위치를 잡았다.
// → 초기 로딩 시 브라우저가 멈추는 근본 원인.
//
// 여기서 ForceAtlas2 레이아웃을 1회 계산해 좌표를 박아두면,
// 클라이언트는 disableSimulation: true 로 물리 계산 없이 그리기만 한다.
//
// 레이아웃엔 구조적 엣지만 사용한다(graphViz.js의 RENDER_EDGE_TYPES와 동일):
//   hasTag / inCategory / inSubcategory / inSeries
// tagCooccurs / related / dependsOn 은 태그를 한 덩어리로 엉키게 하므로 제외.
//
// 결정론적: 초기 배치를 community 기준 원형 분산으로 시드 → 매 실행 동일 결과.
//
// 실행: node scripts/add-layout.mjs  (add-communities.mjs 다음에 실행)
import fs from "node:fs";
import path from "node:path";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

const FILE = path.resolve("public/assets/graph/graph-data.json");
const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));

// 레이아웃에 쓰는 구조적 엣지 타입 (graphViz.js와 일치)
const RENDER_EDGE_TYPES = new Set(["hasTag", "inCategory", "inSubcategory", "inSeries"]);

const ITERATIONS = 500; // 정착에 충분한 반복 수
const RADIUS = 1000; // 초기 원형 분산 반지름

const g = new Graph({ type: "undirected", multi: false });

// community 개수 파악 → 클러스터별 초기 각도 분리
const communities = new Set(data.nodes.map(n => n.community || 0));
const commCount = Math.max(1, communities.size);

// 노드 추가: 초기 위치를 community 기준 원형 + 인덱스 기반 결정론적 분산으로 시드.
// (전부 0,0 에서 시작하면 FA2가 한 점에 갇혀 퍼지지 않는다)
data.nodes.forEach((n, i) => {
  const comm = n.community || 0;
  // 클러스터마다 다른 각도 영역, 노드마다 약간씩 흩뿌림 (deterministic)
  const baseAngle = (comm / commCount) * Math.PI * 2;
  const jitter = ((i * 2654435761) % 1000) / 1000; // 정수 해시 → 0..1
  const angle = baseAngle + (jitter - 0.5) * 0.8;
  const r = RADIUS * (0.3 + jitter * 0.7);
  g.addNode(n.id, {
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r,
    size: n.size || 8,
  });
});

// 구조적 엣지만 추가
let edgeCount = 0;
for (const e of data.edges) {
  if (!RENDER_EDGE_TYPES.has(e.type)) continue;
  if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
  if (g.hasEdge(e.source, e.target)) continue;
  g.addEdge(e.source, e.target, { weight: e.weight || 1 });
  edgeCount++;
}

// FA2 파라미터: 노드 수 기반 자동 추론 + 클러스터 분리 강화
const settings = forceAtlas2.inferSettings(g);
settings.barnesHutOptimize = true; // O(n log n) 근사 → 대규모에서 빠름
settings.gravity = 0.5; // 흩어진 컴포넌트를 중앙으로 살짝 모음
settings.scalingRatio = 12; // 노드 간 간격(척력) — 클러스터끼리 벌어지게
settings.slowDown = 5; // 진동 억제, 안정적 정착
settings.adjustSizes = true; // 노드 크기만큼 겹침 회피

forceAtlas2.assign(g, { iterations: ITERATIONS, settings });

// 계산된 좌표를 노드에 기록 (소수점 2자리로 절삭 → JSON 용량 절감)
const round = v => Math.round(v * 100) / 100;
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const n of data.nodes) {
  const attr = g.getNodeAttributes(n.id);
  n.x = round(attr.x);
  n.y = round(attr.y);
  minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
  minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
}

fs.writeFileSync(FILE, JSON.stringify(data));
console.log(`layout: ${data.nodes.length} nodes, ${edgeCount} structural edges, ${ITERATIONS} iterations`);
console.log(`bounds: x[${round(minX)}, ${round(maxX)}] y[${round(minY)}, ${round(maxY)}]`);
console.log(`graph-data.json 갱신 완료`);
