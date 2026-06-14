// graph-data.json의 각 노드에 community(토픽 클러스터) 인덱스를 구워넣는다.
// 라벨 전파는 tagCooccurs 때문에 한 덩어리로 붕괴하므로,
// 블로그 taxonomy(서브카테고리)를 클러스터로 사용한다. 의미도 있고 색 구분도 또렷.
//
//   post        → 자기 서브카테고리 (없으면 카테고리, 그것도 없으면 misc)
//   subcategory → 자기 자신
//   category    → 자기 자신
//   tag         → 연결된 포스트들의 다수 서브카테고리
//   series      → 소속 포스트들의 다수 서브카테고리
//
// 실행: node scripts/add-communities.mjs
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve("public/assets/graph/graph-data.json");
const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
const byId = new Map(data.nodes.map(n => [n.id, n]));

// 관계 맵 구성
const subcatOfPost = new Map(); // postId -> subcatId
const catOfSubcat = new Map(); // subcatId -> catId
const catOfPost = new Map(); // postId -> catId (직접 연결 있을 때)
const postsOfTag = new Map(); // tagId -> [postId...]
const postsOfSeries = new Map(); // seriesId -> [postId...]

for (const e of data.edges) {
  const s = byId.get(e.source);
  const t = byId.get(e.target);
  if (!s || !t) continue;
  if (e.type === "inSubcategory" && s.type === "post" && t.type === "subcategory") {
    subcatOfPost.set(s.id, t.id);
  } else if (e.type === "inCategory") {
    if (s.type === "subcategory" && t.type === "category") catOfSubcat.set(s.id, t.id);
    else if (s.type === "post" && t.type === "category") catOfPost.set(s.id, t.id);
  } else if (e.type === "hasTag" && s.type === "post" && t.type === "tag") {
    (postsOfTag.get(t.id) || postsOfTag.set(t.id, []).get(t.id)).push(s.id);
  } else if (e.type === "inSeries" && s.type === "post" && t.type === "series") {
    (postsOfSeries.get(t.id) || postsOfSeries.set(t.id, []).get(t.id)).push(s.id);
  }
}

// 포스트의 그룹 키 (서브카테고리 우선 → 카테고리 → misc)
function groupOfPost(postId) {
  const sub = subcatOfPost.get(postId);
  if (sub) return sub;
  const cat = catOfPost.get(postId);
  if (cat) return cat;
  return "misc";
}

// 다수결 헬퍼
function majority(keys) {
  if (!keys.length) return "misc";
  const c = new Map();
  for (const k of keys) c.set(k, (c.get(k) || 0) + 1);
  let best = "misc";
  let bestC = -1;
  for (const [k, v] of c) if (v > bestC || (v === bestC && k < best)) (best = k), (bestC = v);
  return best;
}

const groupKey = new Map(); // nodeId -> group string
for (const n of data.nodes) {
  if (n.type === "subcategory") groupKey.set(n.id, n.id);
  else if (n.type === "category") groupKey.set(n.id, "cat:" + n.id);
  else if (n.type === "post") groupKey.set(n.id, groupOfPost(n.id));
  else if (n.type === "tag")
    groupKey.set(n.id, majority((postsOfTag.get(n.id) || []).map(groupOfPost)));
  else if (n.type === "series")
    groupKey.set(n.id, majority((postsOfSeries.get(n.id) || []).map(groupOfPost)));
  else groupKey.set(n.id, "misc");
}

// 그룹 → 0..K 인덱스 (큰 그룹 먼저)
const sizeByGroup = new Map();
for (const g of groupKey.values()) sizeByGroup.set(g, (sizeByGroup.get(g) || 0) + 1);
const sortedGroups = [...sizeByGroup.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  .map(([g]) => g);
const remap = new Map(sortedGroups.map((g, i) => [g, i]));

for (const n of data.nodes) n.community = remap.get(groupKey.get(n.id));

fs.writeFileSync(FILE, JSON.stringify(data));
const top = sortedGroups
  .slice(0, 12)
  .map((g, i) => `#${i}:${sizeByGroup.get(g)}`)
  .join(" ");
console.log(`communities: ${sortedGroups.length}개`);
console.log(`상위 ${top}`);
console.log(`graph-data.json 갱신 완료 (${data.nodes.length} nodes)`);
