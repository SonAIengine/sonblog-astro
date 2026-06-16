import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const casesPath = resolve(
  repoRoot,
  process.env.SEARCH_EVAL_CASES ?? "search-service/eval-cases.json"
);
const reportDir = resolve(repoRoot, process.env.SEARCH_EVAL_REPORT_DIR ?? "reports");
const apiBase = (process.env.SEARCH_API ?? "https://search.infoedu.co.kr").replace(
  /\/$/,
  ""
);
const limit = Number.parseInt(process.env.SEARCH_EVAL_LIMIT ?? "5", 10);
const timeoutMs = Number.parseInt(process.env.SEARCH_EVAL_TIMEOUT_MS ?? "8000", 10);
const latencyBudgetMs = Number.parseInt(
  process.env.SEARCH_EVAL_LATENCY_BUDGET_MS ?? "800",
  10
);
const rerank = process.env.SEARCH_EVAL_RERANK === "true";

function normalizeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://infoedu.co.kr");
    return `${url.pathname.replace(/\/?$/, "/")}`;
  } catch {
    return String(value).replace(/\/?$/, "/");
  }
}

function isSortedDesc(scores) {
  return scores.every((score, index) => index === 0 || scores[index - 1] >= score);
}

function reciprocalRank(results, relevant) {
  const rank = results.findIndex(result => relevant.has(result.url)) + 1;
  return rank > 0 ? 1 / rank : 0;
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function formatPercent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = performance.now();
    const response = await fetch(url, { signal: controller.signal });
    const elapsed = performance.now() - started;
    const body = await response.text();
    let data = {};
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      data = { parseError: body.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, elapsed, data };
  } finally {
    clearTimeout(timer);
  }
}

function judgeCase(testCase, response) {
  const data = response.data ?? {};
  const rawResults = Array.isArray(data.results) ? data.results : [];
  const results = rawResults.map(result => ({
    url: normalizeUrl(result.url),
    title: result.title ?? "",
    score: typeof result.score === "number" ? result.score : Number.NaN,
  }));
  const scores = results.map(result => result.score).filter(Number.isFinite);
  const relevant = new Set((testCase.relevant ?? []).map(normalizeUrl));
  const isNegative = testCase.type === "negative" || relevant.size === 0;
  const top = results[0];
  const topScore = top?.score ?? 0;
  const rr = reciprocalRank(results, relevant);
  const recall = relevant.size === 0 ? 0 : results.some(result => relevant.has(result.url));
  const top1 = relevant.size === 0 ? false : relevant.has(top?.url);
  const sorted = isSortedDesc(scores);
  const withinLatencyBudget =
    typeof data.ms === "number" ? data.ms <= latencyBudgetMs : response.elapsed <= latencyBudgetMs;

  const checks = [];
  if (!response.ok) checks.push(`HTTP ${response.status}`);
  if (!sorted) checks.push("scores_not_sorted");
  if (!withinLatencyBudget) checks.push("latency_over_budget");

  if (isNegative) {
    const maxTopScore = testCase.maxTopScore ?? 0.55;
    const maxResults = testCase.maxResults ?? 0;
    if (results.length > maxResults && topScore > maxTopScore) {
      checks.push(`overconfident_negative(top=${formatNumber(topScore)})`);
    }
  } else {
    if (!recall) checks.push("no_relevant_in_top_k");
    if (!top1) checks.push("top1_miss");
    if (typeof testCase.minTopScore === "number" && topScore < testCase.minTopScore) {
      checks.push(`top_score_low(${formatNumber(topScore)})`);
    }
  }

  return {
    id: testCase.id,
    query: testCase.query,
    intent: testCase.intent,
    type: isNegative ? "negative" : "positive",
    pass: checks.length === 0,
    checks,
    top1,
    recall,
    mrr: rr,
    sorted,
    latencyMs: data.ms ?? response.elapsed,
    stages: Array.isArray(data.stages) ? data.stages : [],
    topTitle: top?.title ?? "",
    topUrl: top?.url ?? "",
    topScore,
    resultCount: results.length,
    results,
  };
}

function renderMarkdown({ generatedAt, summary, cases }) {
  const failed = cases.filter(result => !result.pass);
  const rows = cases
    .map(result =>
      [
        result.pass ? "PASS" : "FAIL",
        result.id,
        result.type,
        formatNumber(result.topScore),
        result.sorted ? "yes" : "no",
        `${Math.round(result.latencyMs)}ms`,
        result.topTitle.replaceAll("|", "\\|"),
        result.checks.join(", ") || "-",
      ].join(" | ")
    )
    .join("\n");

  const failedDetails = failed.length
    ? failed
        .map(result => {
          const results = result.results
            .map(
              (item, index) =>
                `${index + 1}. ${formatNumber(item.score)} ${item.title} (${item.url})`
            )
            .join("\n");
          return `### ${result.id}\n\n- query: \`${result.query}\`\n- intent: ${result.intent}\n- checks: ${result.checks.join(", ")}\n\n${results}`;
        })
        .join("\n\n")
    : "No failed cases.";

  return `# Search Evaluation

- generatedAt: ${generatedAt}
- api: ${apiBase}
- limit: ${limit}
- rerank: ${rerank}

## Summary

- cases: ${summary.total}
- pass: ${summary.pass}
- fail: ${summary.fail}
- positive top1: ${formatPercent(summary.positiveTop1)}
- positive recall@${limit}: ${formatPercent(summary.positiveRecall)}
- positive MRR@${limit}: ${formatNumber(summary.positiveMrr)}
- negative pass: ${formatPercent(summary.negativePass)}
- sorted score pass: ${formatPercent(summary.sortedPass)}
- avg latency: ${Math.round(summary.avgLatencyMs)}ms

## Cases

status | id | type | topScore | sorted | latency | topTitle | checks
--- | --- | --- | ---: | --- | ---: | --- | ---
${rows}

## Failed Cases

${failedDetails}
`;
}

const generatedAt = new Date().toISOString();
const cases = JSON.parse(await readFile(casesPath, "utf8"));
const evaluated = [];

for (const testCase of cases) {
  const url = new URL(`${apiBase}/search`);
  url.searchParams.set("q", testCase.query);
  url.searchParams.set("limit", String(limit));
  if (rerank) url.searchParams.set("rerank", "true");

  try {
    const response = await fetchWithTimeout(url);
    evaluated.push(judgeCase(testCase, response));
  } catch (error) {
    evaluated.push({
      id: testCase.id,
      query: testCase.query,
      intent: testCase.intent,
      type: testCase.type ?? "positive",
      pass: false,
      checks: [error instanceof Error ? error.message : "unknown_error"],
      top1: false,
      recall: false,
      mrr: 0,
      sorted: false,
      latencyMs: timeoutMs,
      stages: [],
      topTitle: "",
      topUrl: "",
      topScore: 0,
      resultCount: 0,
      results: [],
    });
  }
}

const positive = evaluated.filter(result => result.type === "positive");
const negative = evaluated.filter(result => result.type === "negative");
const summary = {
  total: evaluated.length,
  pass: evaluated.filter(result => result.pass).length,
  fail: evaluated.filter(result => !result.pass).length,
  positiveTop1:
    positive.length === 0
      ? 0
      : positive.filter(result => result.top1).length / positive.length,
  positiveRecall:
    positive.length === 0
      ? 0
      : positive.filter(result => result.recall).length / positive.length,
  positiveMrr:
    positive.length === 0
      ? 0
      : positive.reduce((sum, result) => sum + result.mrr, 0) / positive.length,
  negativePass:
    negative.length === 0
      ? 0
      : negative.filter(result => result.pass).length / negative.length,
  sortedPass: evaluated.filter(result => result.sorted).length / evaluated.length,
  avgLatencyMs:
    evaluated.reduce((sum, result) => sum + result.latencyMs, 0) / evaluated.length,
};

const report = { generatedAt, api: apiBase, limit, rerank, summary, cases: evaluated };
await mkdir(reportDir, { recursive: true });
await writeFile(
  resolve(reportDir, "search-eval.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(resolve(reportDir, "search-eval.md"), renderMarkdown(report));

console.log(JSON.stringify(summary, null, 2));
if (summary.fail > 0 && process.env.SEARCH_EVAL_STRICT === "true") {
  process.exitCode = 1;
}
