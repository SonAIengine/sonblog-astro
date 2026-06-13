#!/usr/bin/env node
/**
 * mermaid 다이어그램 정적 린트 (의존성 0)
 *
 * mermaid v11에서 자주 깨지는 문법 패턴을 빠르게 검사한다.
 * 빌드 전 항상 돌려서 깨진 다이어그램이 배포되는 것을 막는다.
 *
 * 정밀 검증(실제 mermaid 파서로 전수 렌더)은 check-mermaid.mjs 참고.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/content/posts";

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith(".md") || e.endsWith(".mdx")) out.push(p);
  }
  return out;
}

// 각 규칙: 한 줄(line)을 받아 위반이면 true
const RULES = [
  {
    name: "bracket-slash",
    // [/text] : 대괄호 안 '/'로 시작하면 mermaid가 평행사변형([/text/])으로 오인
    test: line => /\[\/[^\]"]/.test(line),
    fix: '대괄호 안 "/"로 시작 → ["/..."] 따옴표로 감싸기',
  },
  {
    name: "paren-edge-label",
    // -->|label()| : edge 라벨에 괄호가 따옴표 없이 있으면 파싱 실패
    test: line =>
      /(-->|---|==>|-\.->|--)\s*\|[^|]*\([^|]*\)[^|]*\|/.test(line) &&
      !/\|\s*"[^|]*"\s*\|/.test(line),
    fix: 'edge 라벨 괄호 () → |"...()"| 따옴표로 감싸기',
  },
  // 주: subgraph "제목"(id 없는 따옴표 제목)은 mermaid v11에서 정상 렌더되므로
  //     린트 규칙에서 제외한다. 실제 깨짐은 위 두 패턴이 대부분이며,
  //     완전한 검증은 check-mermaid.mjs(실제 파서 전수 렌더)로 한다.
];

let problems = 0;
const files = walk(ROOT);

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const startLine = text.slice(0, m.index).split("\n").length;
    m[1].split("\n").forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.test(line)) {
          problems++;
          console.log(
            `${file}:${startLine + 1 + i}  [${rule.name}] ${rule.fix}`
          );
          console.log(`    > ${line.trim()}`);
        }
      }
    });
  }
}

if (problems > 0) {
  console.error(`\n❌ mermaid 린트: ${problems}개 문제 발견 (위 위치 수정 필요)`);
  process.exit(1);
}
console.log(`✅ mermaid 린트: ${files.length}개 글, 문제 없음`);
