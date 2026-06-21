import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const reportDir = resolve(repoRoot, process.env.SEARCH_EVAL_REPORT_DIR ?? "reports");
const reportJsonPath = resolve(reportDir, "search-eval.json");
const historyPath = resolve(reportDir, "search-eval-history.jsonl");
const outputPath = resolve(
  repoRoot,
  process.env.SEARCH_QUALITY_OUTPUT ?? "public/assets/search/search-quality.json"
);
const historyLimit = Number.parseInt(process.env.SEARCH_QUALITY_HISTORY_LIMIT ?? "60", 10);

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonl(path) {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactSummary(summary = {}) {
  return {
    total: summary.total ?? 0,
    pass: summary.pass ?? 0,
    fail: summary.fail ?? 0,
    positiveTop1: round(summary.positiveTop1 ?? 0),
    positiveRecall: round(summary.positiveRecall ?? 0),
    positiveMrr: round(summary.positiveMrr ?? 0),
    negativePass: round(summary.negativePass ?? 0),
    sortedPass: round(summary.sortedPass ?? 0),
    avgLatencyMs: round(summary.avgLatencyMs ?? 0, 1),
    p95LatencyMs: round(summary.p95LatencyMs ?? 0, 1),
    maxLatencyMs: round(summary.maxLatencyMs ?? 0, 1),
    stageCounts: summary.stageCounts ?? {},
  };
}

function compactHistory(entry) {
  return {
    generatedAt: entry.generatedAt,
    api: entry.api,
    limit: entry.limit,
    rerank: Boolean(entry.rerank),
    summary: compactSummary(entry.summary),
    failedCaseIds: entry.failedCaseIds ?? [],
  };
}

function delta(current, previous, selector) {
  if (!current || !previous) return 0;
  return round(selector(current.summary) - selector(previous.summary), 3);
}

function latestFailures(report) {
  return (report?.cases ?? [])
    .filter(result => !result.pass)
    .map(result => ({
      id: result.id,
      query: result.query,
      intent: result.intent,
      checks: result.checks ?? [],
      topTitle: result.topTitle,
      topUrl: result.topUrl,
      topScore: round(result.topScore ?? 0),
      topSources: result.topSources ?? [],
    }));
}

const latestReport = await readJson(reportJsonPath);
const apiFilter = process.env.SEARCH_QUALITY_API_FILTER ?? latestReport?.api ?? "";
const allHistory = (await readJsonl(historyPath)).map(compactHistory);
const history = apiFilter
  ? allHistory.filter(entry => entry.api === apiFilter)
  : allHistory;

if (history.length === 0 && latestReport) {
  history.push(
    compactHistory({
      generatedAt: latestReport.generatedAt,
      api: latestReport.api,
      limit: latestReport.limit,
      rerank: latestReport.rerank,
      summary: latestReport.summary,
      failedCaseIds: latestFailures(latestReport).map(item => item.id),
    })
  );
}

const trimmedHistory = history.slice(-historyLimit);
const latest = latestReport
  ? {
      generatedAt: latestReport.generatedAt,
      api: latestReport.api,
      limit: latestReport.limit,
      rerank: Boolean(latestReport.rerank),
      summary: compactSummary(latestReport.summary),
      failedCases: latestFailures(latestReport),
    }
  : (trimmedHistory.at(-1) ?? null);
const previous = trimmedHistory.length > 1 ? trimmedHistory.at(-2) : null;

const dashboard = {
  generatedAt: new Date().toISOString(),
  source: {
    report: "reports/search-eval.json",
    history: "reports/search-eval-history.jsonl",
    cases: "search-service/eval-cases.json",
  },
  historyCount: history.length,
  latest,
  previous,
  deltas: {
    passRate: delta(latest, previous, summary => summary.total ? summary.pass / summary.total : 0),
    positiveTop1: delta(latest, previous, summary => summary.positiveTop1 ?? 0),
    positiveRecall: delta(latest, previous, summary => summary.positiveRecall ?? 0),
    positiveMrr: delta(latest, previous, summary => summary.positiveMrr ?? 0),
    p95LatencyMs: delta(latest, previous, summary => summary.p95LatencyMs ?? 0),
    avgLatencyMs: delta(latest, previous, summary => summary.avgLatencyMs ?? 0),
  },
  stageCoverage: Object.entries(latest?.summary?.stageCounts ?? {})
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage)),
  history: trimmedHistory,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`search quality dashboard data: ${outputPath}`);
