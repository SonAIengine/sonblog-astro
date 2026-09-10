const SITE_ORIGIN = "https://infoedu.co.kr";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY = "37ae641a74d510bce2c23f53822ab97bb3a7a7315e103d2b";
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_URLS_PER_REQUEST = 10_000;
const PUBLISH_RETRIES = 12;
const PUBLISH_RETRY_DELAY_MS = 5_000;
const CORE_PATHS = [
  "/",
  "/posts/",
  "/topics/",
  "/topics/ai/",
  "/topics/search-engine/",
  "/topics/full-stack/",
  "/topics/devops/",
];

const args = new Set(process.argv.slice(2));
const submitAll = args.has("--all");
const dryRun = args.has("--dry-run");
const sinceArg = process.argv
  .slice(2)
  .find(argument => argument.startsWith("--since="))
  ?.slice("--since=".length);
const sinceValue = sinceArg || process.env.INDEXNOW_SINCE;
const since = sinceValue
  ? new Date(sinceValue)
  : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

if (!submitAll && Number.isNaN(since.getTime())) {
  throw new Error(`Invalid IndexNow cutoff date: ${sinceValue}`);
}

// Sitemap lastmod may be a date without a time. Include the whole cutoff day.
since.setUTCHours(0, 0, 0, 0);

function decodeXML(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function firstTag(xml, tag) {
  return xml
    .match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]
    ?.trim();
}

function sitemapEntries(xml) {
  return [...xml.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gi)]
    .map(match => ({
      loc: firstTag(match[1], "loc"),
      lastmod: firstTag(match[1], "lastmod"),
    }))
    .filter(entry => entry.loc)
    .map(entry => ({
      url: decodeXML(entry.loc),
      lastmod: entry.lastmod ? new Date(entry.lastmod) : undefined,
    }));
}

async function fetchText(url) {
  const requestURL = new URL(url);
  requestURL.searchParams.set("indexnow_check", Date.now().toString());
  const response = await fetch(requestURL, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      "User-Agent": "SON-BLOG-IndexNow/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function waitForPublishedKey() {
  const keyURL = new URL(`/${INDEXNOW_KEY}.txt`, SITE_ORIGIN);

  for (let attempt = 1; attempt <= PUBLISH_RETRIES; attempt += 1) {
    try {
      if ((await fetchText(keyURL)).trim() === INDEXNOW_KEY) return;
    } catch {
      // GitHub Pages may need a short propagation window after deploy.
    }

    if (attempt < PUBLISH_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
    }
  }

  throw new Error(`IndexNow key is not published at ${keyURL.href}`);
}

if (!dryRun) await waitForPublishedKey();

const sitemapIndexURL = new URL("/sitemap.xml", SITE_ORIGIN);
const sitemapIndex = await fetchText(sitemapIndexURL);
const entries = /<urlset(?:\s[^>]*)?>/i.test(sitemapIndex)
  ? sitemapEntries(sitemapIndex)
  : (
      await Promise.all(
        [...sitemapIndex.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)]
          .map(match => decodeXML(match[1].trim()))
          .map(url => fetchText(url).then(sitemapEntries))
      )
    ).flat();

if (entries.length === 0) {
  throw new Error(`No URLs found in ${sitemapIndexURL.href}`);
}
const selectedURLs = entries
  .filter(entry => new URL(entry.url).origin === SITE_ORIGIN)
  .filter(entry => submitAll || (entry.lastmod && entry.lastmod >= since))
  .map(entry => entry.url);

for (const path of CORE_PATHS) {
  selectedURLs.push(new URL(path, SITE_ORIGIN).href);
}

const urlList = [...new Set(selectedURLs)];
if (urlList.length === 0) {
  console.log("No updated URLs to submit to IndexNow.");
  process.exit(0);
}

if (dryRun) {
  console.log(JSON.stringify({ urlList }, null, 2));
  process.exit(0);
}

let submitted = 0;
for (let offset = 0; offset < urlList.length; offset += MAX_URLS_PER_REQUEST) {
  const batch = urlList.slice(offset, offset + MAX_URLS_PER_REQUEST);
  const payload = {
    host: new URL(SITE_ORIGIN).hostname,
    key: INDEXNOW_KEY,
    keyLocation: new URL(`/${INDEXNOW_KEY}.txt`, SITE_ORIGIN).href,
    urlList: batch,
  };
  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  if (![200, 202].includes(response.status)) {
    throw new Error(
      `IndexNow submission failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  submitted += batch.length;
}

console.log(`Submitted ${submitted} URL(s) to IndexNow.`);
