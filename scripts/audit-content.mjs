import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src/content/posts");
const REPORT_DIR = path.resolve("reports");
const REPORT_FILE = path.join(REPORT_DIR, "content-quality.md");
const STRICT = process.argv.includes("--strict");

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else if (/\.(md|mdx)$/.test(entry.name)) files.push(abs);
  }
  return files;
}

function frontmatterOf(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : "";
}

function bodyOf(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function scalar(fm, key) {
  const lines = fm.split(/\r?\n/);
  const index = lines.findIndex(line => new RegExp(`^${key}:\\s*`).test(line));
  if (index === -1) return "";

  const first = lines[index].replace(new RegExp(`^${key}:\\s*`), "");
  const continuation = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line) || /^-\s+/.test(line)) break;
    if (/^\s+/.test(line)) continuation.push(line.trim());
    else break;
  }
  return [first, ...continuation]
    .join(" ")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function list(fm, key) {
  const lines = fm.split(/\r?\n/);
  const index = lines.findIndex(line => new RegExp(`^${key}:\\s*`).test(line));
  if (index === -1) return [];

  const first = lines[index].replace(new RegExp(`^${key}:\\s*`), "").trim();
  if (first.startsWith("[") && first.endsWith("]")) {
    return first
      .slice(1, -1)
      .split(",")
      .map(item => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  const values = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) break;
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) values.push(match[1].replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

function add(issueMap, severity, file, message) {
  const rel = path.relative(process.cwd(), file);
  const bucket = issueMap.get(rel) ?? [];
  bucket.push({ severity, message });
  issueMap.set(rel, bucket);
}

const files = walk(ROOT);
const issues = new Map();
const titleMap = new Map();
const descMap = new Map();
let postsWithoutInternalLinks = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const fm = frontmatterOf(text);
  const body = bodyOf(text);
  const title = scalar(fm, "title");
  const description = scalar(fm, "description");
  const pubDatetime = scalar(fm, "pubDatetime");
  const modDatetime = scalar(fm, "modDatetime");
  const tags = list(fm, "tags");

  if (!title) add(issues, "error", file, "title 누락");
  if (!description) add(issues, "error", file, "description 누락");
  if (!pubDatetime) add(issues, "error", file, "pubDatetime 누락");
  if (tags.length === 0) add(issues, "error", file, "tags 누락");

  if (title.length > 90) add(issues, "warn", file, `title 길이 ${title.length}자`);
  if (description && description.length < 50) {
    add(issues, "warn", file, `description이 짧음 (${description.length}자)`);
  }
  if (description.length > 180) {
    add(issues, "warn", file, `description이 김 (${description.length}자)`);
  }
  if (tags.length > 12) add(issues, "warn", file, `태그 과다 (${tags.length}개)`);
  if (tags.length === 1) add(issues, "warn", file, "태그가 1개뿐임");

  if (/^```\s*$/m.test(body)) {
    add(issues, "warn", file, "언어가 없는 코드블록 존재");
  }
  if (/!\[\s*\]\(/.test(body)) {
    add(issues, "warn", file, "alt가 비어 있는 Markdown 이미지 존재");
  }
  if (/<img(?![^>]*\salt=)/i.test(body)) {
    add(issues, "warn", file, "alt 없는 HTML img 존재");
  }

  const hasInternalLink =
    /\]\(\/(?!\/)/.test(body) || /href=["']\/(?!\/)/.test(body);
  if (!hasInternalLink) postsWithoutInternalLinks += 1;
  if (!hasInternalLink) add(issues, "info", file, "본문 내부 링크 없음");

  if (pubDatetime && !modDatetime) {
    const ageMs = Date.now() - Date.parse(pubDatetime);
    const days = Math.floor(ageMs / 86_400_000);
    if (Number.isFinite(days) && days > 365) {
      add(issues, "info", file, `1년 이상 지난 글, modDatetime 없음 (${days}일)`);
    }
  }

  if (title) {
    const dup = titleMap.get(title) ?? [];
    dup.push(file);
    titleMap.set(title, dup);
  }
  if (description) {
    const dup = descMap.get(description) ?? [];
    dup.push(file);
    descMap.set(description, dup);
  }
}

for (const [, dupFiles] of titleMap) {
  if (dupFiles.length < 2) continue;
  dupFiles.forEach(file => add(issues, "warn", file, "중복 title"));
}
for (const [, dupFiles] of descMap) {
  if (dupFiles.length < 2) continue;
  dupFiles.forEach(file => add(issues, "warn", file, "중복 description"));
}

const rows = [...issues.entries()].sort((a, b) => b[1].length - a[1].length);
const counts = { error: 0, warn: 0, info: 0 };
for (const [, fileIssues] of rows) {
  for (const issue of fileIssues) counts[issue.severity] += 1;
}

const report = [
  "# Content Quality Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `- Posts scanned: ${files.length}`,
  `- Files with issues: ${rows.length}`,
  `- Errors: ${counts.error}`,
  `- Warnings: ${counts.warn}`,
  `- Info: ${counts.info}`,
  `- Posts without explicit internal links: ${postsWithoutInternalLinks}`,
  "",
  "## Issues",
  "",
  ...rows.flatMap(([file, fileIssues]) => [
    `### ${file}`,
    "",
    ...fileIssues.map(issue => `- **${issue.severity}**: ${issue.message}`),
    "",
  ]),
].join("\n");

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, report);

console.log(
  JSON.stringify(
    {
      posts: files.length,
      filesWithIssues: rows.length,
      counts,
      report: path.relative(process.cwd(), REPORT_FILE),
    },
    null,
    2
  )
);

if (STRICT && counts.error > 0) process.exit(1);
