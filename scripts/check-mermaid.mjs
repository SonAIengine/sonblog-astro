#!/usr/bin/env node
/**
 * mermaid 다이어그램 정밀 검증 (실제 mermaid 파서로 전수 렌더)
 *
 * 헤드리스 Chrome에 mermaid를 띄워 모든 다이어그램을 실제로 parse한다.
 * 정적 린트(lint-mermaid.mjs)가 놓치는 모든 문법 오류를 100% 잡는다.
 * 단 Chrome이 필요하므로 로컬/수동 검증용. (CI 빠른 검사는 정적 린트 사용)
 *
 * 사용: node scripts/check-mermaid.mjs
 *   Chrome 경로가 특이하면 PUPPETEER_EXECUTABLE_PATH 환경변수로 지정.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = "src/content/posts";

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const cands = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const c of cands) {
    try {
      statSync(c);
      return c;
    } catch {}
  }
  throw new Error(
    "Chrome 실행 파일을 찾을 수 없습니다. PUPPETEER_EXECUTABLE_PATH 환경변수로 지정하세요."
  );
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith(".md") || e.endsWith(".mdx")) out.push(p);
  }
  return out;
}

const blocks = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    blocks.push({ file, line, code: m[1] });
  }
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({
  url: "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
});
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));

let broken = 0;
for (const blk of blocks) {
  const err = await page.evaluate(async code => {
    try {
      await window.mermaid.parse(code);
      return null;
    } catch (e) {
      return (e && e.message) || String(e);
    }
  }, blk.code);
  if (err) {
    broken++;
    console.log(`${blk.file}:${blk.line}  ${err.split("\n")[0]}`);
  }
}
await browser.close();

if (broken > 0) {
  console.error(`\n❌ mermaid 정밀 검증: ${broken}/${blocks.length}개 깨짐`);
  process.exit(1);
}
console.log(`✅ mermaid 정밀 검증: ${blocks.length}개 다이어그램 모두 정상`);
