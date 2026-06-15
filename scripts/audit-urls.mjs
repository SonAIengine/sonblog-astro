import fs from "node:fs";
import path from "node:path";
import redirects from "../src/redirects.generated.json" with { type: "json" };

const DIST = path.resolve("dist");
const SITE_ORIGIN = "https://infoedu.co.kr";
const LEGACY_PREFIX_RE = /^\/(?:ai|search-engine|devops|full-stack)\//;

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else if (entry.name === "index.html") files.push(abs);
  }
  return files;
}

function routeOf(file) {
  return `/${path.relative(DIST, file).replace(/\\/g, "/").replace(/index\.html$/, "")}`;
}

function canonicalOf(html) {
  return html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? "";
}

function isNoindex(html) {
  return /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
}

function isRedirectHtml(html) {
  return /http-equiv="refresh"|Redirecting to:/i.test(html);
}

function sitemapUrls() {
  const files = fs
    .readdirSync(DIST)
    .filter(file => /^sitemap-\d+\.xml$/.test(file))
    .map(file => path.join(DIST, file));
  return files.flatMap(file =>
    [...fs.readFileSync(file, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      match => new URL(match[1]).pathname
    )
  );
}

const htmlFiles = walk(DIST);
const pages = htmlFiles.map(file => {
  const html = fs.readFileSync(file, "utf8");
  return {
    file,
    route: routeOf(file),
    canonical: canonicalOf(html),
    noindex: isNoindex(html),
    redirect: isRedirectHtml(html),
  };
});

const urls = sitemapUrls();
const redirectRoutes = new Set(Object.keys(redirects));
const failures = [];

const sitemapRedirects = urls.filter(url => redirectRoutes.has(url));
if (sitemapRedirects.length) {
  failures.push(
    `Sitemap contains redirect routes: ${sitemapRedirects.slice(0, 10).join(", ")}`
  );
}

const legacySitemapUrls = urls.filter(url => LEGACY_PREFIX_RE.test(url));
if (legacySitemapUrls.length) {
  failures.push(
    `Sitemap contains legacy category URLs: ${legacySitemapUrls
      .slice(0, 10)
      .join(", ")}`
  );
}

const badRedirectPages = pages.filter(
  page => page.redirect && (!page.noindex || !page.canonical)
);
if (badRedirectPages.length) {
  failures.push(
    `Redirect pages missing noindex/canonical: ${badRedirectPages
      .slice(0, 10)
      .map(page => page.route)
      .join(", ")}`
  );
}

const contentByCanonical = new Map();
for (const page of pages) {
  if (!page.canonical || page.redirect || page.noindex) continue;
  const list = contentByCanonical.get(page.canonical) ?? [];
  list.push(page.route);
  contentByCanonical.set(page.canonical, list);
}

const duplicatedCanonicalContent = [...contentByCanonical.entries()].filter(
  ([, routes]) => routes.length > 1
);
if (duplicatedCanonicalContent.length) {
  failures.push(
    `Non-redirect pages share canonical URLs: ${duplicatedCanonicalContent
      .slice(0, 5)
      .map(([canonical, routes]) => `${canonical} <= ${routes.join(", ")}`)
      .join(" | ")}`
  );
}

const postRoutes = urls.filter(url => url.startsWith("/posts/")).length;
const tagRoutes = urls.filter(url => url.startsWith("/tags/")).length;
const topicRoutes = urls.filter(url => url.startsWith("/topics/")).length;

console.log(
  JSON.stringify(
    {
      htmlFiles: pages.length,
      redirectPages: pages.filter(page => page.redirect).length,
      sitemapUrls: urls.length,
      sitemapGroups: {
        posts: postRoutes,
        tags: tagRoutes,
        topics: topicRoutes,
      },
      canonicalContentDuplicates: duplicatedCanonicalContent.length,
      redirectRoutes: redirectRoutes.size,
    },
    null,
    2
  )
);

if (failures.length) {
  console.error(`URL audit failed for ${SITE_ORIGIN}`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("URL audit passed");
