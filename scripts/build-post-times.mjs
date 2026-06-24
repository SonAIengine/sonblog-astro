#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outFile = join(root, "src/generated/post-times.json");
const timezone = "Asia/Seoul";

function runGit(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function extractPubDatetime(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;

  const match = frontmatter[1].match(
    /^pubDatetime:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m
  );

  return match?.[1]?.trim() ?? null;
}

function toKstIso(date) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(date);

  return `${formatted.replace(" ", "T")}+09:00`;
}

function toPostId(file) {
  return file
    .replace(/^src\/content\/posts\//, "")
    .replace(/\.(md|mdx)$/i, "")
    .toLowerCase();
}

function firstGitAuthorDate(file) {
  const lines = runGit(["log", "--follow", "--format=%aI", "--", file])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? null;
}

let files = [];

try {
  files = runGit(["ls-files", "src/content/posts"])
    .split(/\r?\n/)
    .filter(file => /\.(md|mdx)$/i.test(file));
} catch (error) {
  console.warn(
    "[post-times] Git metadata is unavailable; writing an empty time map."
  );
  console.warn(error instanceof Error ? error.message : String(error));
}

const entries = [];

for (const file of files) {
  const content = readFileSync(join(root, file), "utf8");
  const pubDatetime = extractPubDatetime(content);

  if (!pubDatetime || !/^\d{4}-\d{2}-\d{2}$/.test(pubDatetime)) {
    continue;
  }

  const firstAddedAt = firstGitAuthorDate(file);
  if (!firstAddedAt) continue;

  const datetime = toKstIso(new Date(firstAddedAt));
  const gitDate = datetime.slice(0, 10);

  if (gitDate !== pubDatetime) {
    continue;
  }

  entries.push([
    toPostId(file),
    {
      datetime,
      source: "git-first-author-date",
      frontmatterDate: pubDatetime,
      firstAddedAt,
    },
  ]);
}

entries.sort(([, a], [, b]) => b.datetime.localeCompare(a.datetime));

const postTimes = {
  timezone,
  strategy:
    "Use Git first-author time only when it falls on the same KST date as date-only pubDatetime.",
  posts: Object.fromEntries(entries),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(postTimes, null, 2)}\n`);

console.log(`[post-times] wrote ${entries.length} post publish times`);
