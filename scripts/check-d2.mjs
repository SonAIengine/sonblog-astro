#!/usr/bin/env node
/**
 * D2 다이어그램 정적 렌더 검증.
 *
 * ```d2 코드 블록을 실제 SVG로 렌더링해 문법 오류와 렌더 실패를 빌드 전에 잡는다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = "src/content/posts";
const RENDERER = "scripts/render-d2-block.mjs";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith(".md") || entry.endsWith(".mdx")) out.push(path);
  }
  return out;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

const blocks = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  const re = /```d2(?:[^\n]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    blocks.push({
      file,
      line: text.slice(0, match.index).split("\n").length,
      code: match[1],
    });
  }
}

let broken = 0;
for (const block of blocks) {
  const result = spawnSync(
    process.execPath,
    [RENDERER],
    {
      encoding: "utf8",
      input: JSON.stringify({
        code: block.code,
        options: { themeID: 4, pad: 48 },
        salt: hash(`${block.file}:${block.line}\n${block.code}`),
      }),
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (result.status !== 0) {
    broken += 1;
    const message = (result.stderr || result.stdout || "Unknown D2 error")
      .trim()
      .split("\n")[0];
    console.log(`${block.file}:${block.line}  ${message}`);
  }
}

if (broken > 0) {
  console.error(`\n❌ D2 검증: ${broken}/${blocks.length}개 깨짐`);
  process.exit(1);
}

console.log(`✅ D2 검증: ${blocks.length}개 다이어그램 모두 정상`);
