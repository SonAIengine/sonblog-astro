// SEO 리다이렉트 맵 생성: 옛 MkDocs URL → 새 Astro URL.
// 옛 docs(로컬 mkdocs 레포)의 경로·제목과 새 search-index의 url·제목을
// 제목으로 매칭한다(슬러그가 바뀐 글도 정확히 연결). 매칭 실패 시 같은 경로
// (/posts 접두) 폴백. 결과를 src/redirects.generated.json 으로 출력.
//
// 실행: node scripts/build-redirects.mjs
import fs from "node:fs";
import path from "node:path";

const DOCS = process.env.MKDOCS_DOCS || "/home/son/projects/blog/sonblog/docs";
const INDEX = path.resolve("dist/search-index.json");
const OUT = path.resolve("src/redirects.generated.json");

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// MkDocs(use_directory_urls) URL: docs/a/b.md → /a/b/ , a/index.md → /a/
function oldUrlOf(rel) {
  let p = rel.replace(/\\/g, "/").replace(/\.md$/, "");
  if (p === "index") return "/";
  if (p.endsWith("/index")) p = p.slice(0, -"/index".length);
  return `/${p}/`;
}
function titleOf(abs) {
  const t = fs.readFileSync(abs, "utf-8");
  const fm = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (m) return m[1].trim();
  }
  const h1 = t.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : null;
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (e.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

const newDocs = JSON.parse(fs.readFileSync(INDEX, "utf-8"));
const newByTitle = new Map(newDocs.map(d => [norm(d.title), d.url]));
const newUrlSet = new Set(newDocs.map(d => d.url));

const redirects = {};
let matched = 0,
  fallback = 0,
  missed = 0;
const misses = [];

for (const abs of walk(DOCS)) {
  const rel = path.relative(DOCS, abs);
  if (/(^|\/)index\.md$/.test(rel)) continue; // 카테고리 랜딩은 제외
  if (/notes\/draft/.test(rel)) continue;
  const oldUrl = oldUrlOf(rel);
  const title = titleOf(abs);
  let newUrl = title ? newByTitle.get(norm(title)) : null;
  if (newUrl) matched++;
  else {
    const cand = `/posts${oldUrl}`; // 경로 동일 폴백
    if (newUrlSet.has(cand)) {
      newUrl = cand;
      fallback++;
    }
  }
  if (newUrl && newUrl !== oldUrl) redirects[oldUrl] = newUrl;
  else if (!newUrl) {
    missed++;
    if (misses.length < 12) misses.push(`${oldUrl}  (${title || "no-title"})`);
  }
}

// ── 카테고리/서브카테고리 랜딩 페이지 → 태그 페이지 ───────────────────────────
// 옛 MkDocs는 /ai/ , /ai/agent/ 같은 디렉토리 랜딩이 존재. 새 사이트엔 없으므로
// 대응 태그 페이지(/tags/{slug}/)로 보낸다. 태그가 없으면 상위 카테고리, 그것도
// 없으면 /posts/.
function tagExists(slug) {
  return fs.existsSync(path.resolve("dist/tags", slug, "index.html"));
}
function walkDirs(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(r);
    out.push(...walkDirs(path.join(dir, e.name), r));
  }
  return out;
}
for (const rel of walkDirs(DOCS)) {
  if (/^(notes\/draft)/.test(rel)) continue;
  const oldUrl = `/${rel}/`;
  if (redirects[oldUrl]) continue;
  const segs = rel.split("/");
  const last = segs[segs.length - 1];
  const top = segs[0];
  let dest = tagExists(last)
    ? `/tags/${last}/`
    : tagExists(top)
      ? `/tags/${top}/`
      : "/posts/";
  redirects[oldUrl] = dest;
}

// ── 특수 페이지 ──
const SPECIAL = { "/portfolio/en/": "/portfolio-en/" };
for (const [o, n] of Object.entries(SPECIAL)) redirects[o] = n;

// 실제 Astro 페이지가 있는 경로는 리다이렉트에서 제외 — 그 페이지를 가리지 않게.
// (예: 옛 mkdocs /portfolio/ 섹션이 새 portfolio.astro 쇼케이스를 덮어쓰던 버그 방지)
const REAL_PAGES = ["/", "/portfolio/", "/portfolio-en/", "/graph/", "/posts/", "/tags/", "/archives/", "/search/"];
for (const p of REAL_PAGES) delete redirects[p];

fs.writeFileSync(OUT, JSON.stringify(redirects));
console.log(
  `redirects: ${Object.keys(redirects).length} (글 title매칭 ${matched}, 경로폴백 ${fallback}, 미매칭 ${missed})`
);
if (misses.length) console.log("글 미매칭 샘플:\n  " + misses.join("\n  "));
