// SEO 리다이렉트 맵 생성: 옛 MkDocs URL → 새 Astro URL.
// 옛 docs(로컬 mkdocs 레포)의 경로·제목과 새 Astro 원문의 경로·제목을
// 제목으로 매칭한다(슬러그가 바뀐 글도 정확히 연결). 매칭 실패 시 같은 경로
// 기준으로 연결한다. 결과를 src/redirects.generated.json 으로 출력.
//
// 실행: node scripts/build-redirects.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DOCS = process.env.MKDOCS_DOCS || "/home/son/projects/blog/sonblog/docs";
const DOCS_REPO = path.resolve(DOCS, "..");
const POSTS = path.resolve("src/content/posts");
const OUT = path.resolve("src/redirects.generated.json");

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// MkDocs(use_directory_urls) URL: docs/a/b.md → /a/b/ , a/index.md → /a/
function contentUrlOf(rel) {
  let p = rel.replace(/\\/g, "/").replace(/\.mdx?$/, "");
  if (p === "index") return "/";
  if (p.endsWith("/index")) p = p.slice(0, -"/index".length);
  return `/${p}/`;
}
const oldUrlOf = contentUrlOf;
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
function isDraft(abs) {
  const source = fs.readFileSync(abs, "utf-8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return /^draft:\s*true\s*$/im.test(frontmatter);
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (/\.mdx?$/.test(e.name)) out.push(abs);
  }
  return out;
}

function historicalRenames() {
  const docsPrefix = `${path.relative(DOCS_REPO, DOCS).replace(/\\/g, "/")}/`;
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "-C",
        DOCS_REPO,
        "log",
        "--all",
        "--diff-filter=R",
        "--name-status",
        "-z",
        "--format=",
      ],
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
    );
  } catch (error) {
    console.warn(`Git rename 이력을 읽지 못했습니다: ${error.message}`);
    return [];
  }

  const fields = output.split("\0").filter(Boolean);
  const forwards = new Map();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [status, oldPath, newPath] = fields.slice(index, index + 3);
    // git log는 최신 커밋부터 나오므로 같은 출발 경로의 첫 rename이 최종 이력에 가깝다.
    if (/^R\d+$/.test(status) && !forwards.has(oldPath)) {
      forwards.set(oldPath, newPath);
    }
  }

  function finalPath(start) {
    const seen = new Set();
    let current = start;
    while (forwards.has(current) && !seen.has(current)) {
      seen.add(current);
      current = forwards.get(current);
    }
    return current;
  }

  const aliases = [];
  for (const oldPath of forwards.keys()) {
    if (!oldPath.startsWith(docsPrefix) || !oldPath.endsWith(".md")) continue;

    const currentPath = finalPath(oldPath);
    if (!currentPath.startsWith(docsPrefix) || !currentPath.endsWith(".md")) {
      continue;
    }

    const currentAbs = path.join(DOCS_REPO, currentPath);
    if (!fs.existsSync(currentAbs)) continue;

    aliases.push({
      oldUrl: oldUrlOf(oldPath.slice(docsPrefix.length)),
      currentAbs,
      currentRel: currentPath.slice(docsPrefix.length),
    });
  }
  return aliases;
}

const newDocs = walk(POSTS)
  .filter(abs => !path.basename(abs).startsWith("_"))
  .filter(abs => !isDraft(abs))
  .map(abs => ({
    title: titleOf(abs),
    url: contentUrlOf(path.relative(POSTS, abs)),
  }))
  .filter(doc => doc.title);
const newByTitle = new Map(newDocs.map(doc => [norm(doc.title), doc.url]));
const newUrlSet = new Set(newDocs.map(doc => doc.url));

const redirects = {};
let matched = 0,
  fallback = 0,
  historical = 0,
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
    const cand = oldUrl;
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

const redirectRouteKeys = new Set(
  Object.keys(redirects).map(url => url.toLowerCase())
);

// Git 이력에만 남은 예전 한글/대문자 파일명도 현재 글로 연결한다.
// 파일을 정리하면서 URL까지 바뀐 경우 기존 외부 링크와 Google 발견 신호를 보존한다.
for (const { oldUrl, currentAbs, currentRel } of historicalRenames()) {
  // Astro는 경로를 디코딩하고 대소문자 구분 없이 비교한다. URL 구분 문자가
  // 파일명에 있거나 대소문자만 다른 별칭은 유효한 정적 route가 될 수 없다.
  const routeKey = oldUrl.toLowerCase();
  if (/[?#%]/.test(oldUrl) || redirectRouteKeys.has(routeKey)) continue;

  const title = titleOf(currentAbs);
  let newUrl = title ? newByTitle.get(norm(title)) : null;
  if (!newUrl) {
    const candidate = oldUrlOf(currentRel);
    if (newUrlSet.has(candidate)) newUrl = candidate;
  }

  if (newUrl && newUrl !== oldUrl) {
    redirects[oldUrl] = newUrl;
    redirectRouteKeys.add(routeKey);
    historical++;
  }
}

// ── 카테고리/서브카테고리 랜딩 페이지 → 토픽/태그 페이지 ─────────────────────
// 옛 MkDocs는 /ai/ , /ai/agent/ 같은 디렉토리 랜딩이 존재. 새 사이트엔 없으므로
// 상위 주제는 새 topic hub로 보내고, 세부 디렉토리는 대응 태그 페이지를 우선한다.
// 태그가 없으면 상위 topic hub, 그것도 없으면 /posts/.
const TOPIC_SLUGS = new Set(["ai", "search-engine", "full-stack", "devops"]);
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
  const top = segs[0];
  let dest =
    top === "portfolio"
      ? "/portfolio/"
      : TOPIC_SLUGS.has(top)
        ? `/topics/${top}/`
        : "/posts/";
  redirects[oldUrl] = dest;
}

// ── 특수 페이지 ──
const SPECIAL = { "/portfolio/en/": "/portfolio-en/" };
for (const [o, n] of Object.entries(SPECIAL)) redirects[o] = n;

// 실제 Astro 페이지가 있는 경로는 리다이렉트에서 제외 — 그 페이지를 가리지 않게.
// (예: 옛 mkdocs /portfolio/ 섹션이 새 portfolio.astro 쇼케이스를 덮어쓰던 버그 방지)
const REAL_PAGES = [
  "/",
  "/portfolio/",
  "/portfolio-en/",
  "/graph/",
  "/posts/",
  "/tags/",
  "/archives/",
  "/search/",
  "/topics/",
  "/topics/ai/",
  "/topics/search-engine/",
  "/topics/full-stack/",
  "/topics/devops/",
];
for (const p of REAL_PAGES) delete redirects[p];
for (const p of newUrlSet) delete redirects[p];
const newRouteKeys = new Set([...newUrlSet].map(url => url.toLowerCase()));
for (const source of Object.keys(redirects)) {
  if (newRouteKeys.has(source.toLowerCase())) delete redirects[source];
}

function resolveDestination(source) {
  const seen = new Set([source]);
  let destination = redirects[source];
  while (destination && redirects[destination]) {
    if (seen.has(destination)) {
      throw new Error(`Redirect cycle: ${[...seen, destination].join(" -> ")}`);
    }
    seen.add(destination);
    destination = redirects[destination];
  }
  return destination;
}

for (const source of Object.keys(redirects)) {
  redirects[source] = resolveDestination(source);
}

fs.writeFileSync(OUT, `${JSON.stringify(redirects, null, 2)}\n`);
console.log(
  `redirects: ${Object.keys(redirects).length} (글 title매칭 ${matched}, 경로폴백 ${fallback}, Git 이력 ${historical}, 미매칭 ${missed})`
);
if (misses.length) console.log("글 미매칭 샘플:\n  " + misses.join("\n  "));
