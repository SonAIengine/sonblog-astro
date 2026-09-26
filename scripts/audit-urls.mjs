import fs from "node:fs";
import path from "node:path";
import redirects from "../src/redirects.generated.json" with { type: "json" };

const DIST = path.resolve("dist");
const SITE_ORIGIN = "https://infoedu.co.kr";

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

function staticFileExists(pathname) {
  const relative = pathname.replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return false;
  const abs = path.join(DIST, relative);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
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

function anchorHrefs(html) {
  return [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)].map(
    match => match[1]
  );
}

function sitemapEntries() {
  const files = fs
    .readdirSync(DIST)
    .filter(file => /^sitemap-\d+\.xml$/.test(file))
    .map(file => path.join(DIST, file));
  return files.flatMap(file =>
    [...fs.readFileSync(file, "utf8").matchAll(/<url>([\s\S]*?)<\/url>/g)].map(
      match => {
        const block = match[1];
        const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "";
        return {
          loc,
          pathname: new URL(loc).pathname,
          lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
        };
      }
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
    hrefs: anchorHrefs(html),
  };
});

const sitemap = sitemapEntries();
const urls = sitemap.map(entry => entry.pathname);
const redirectRoutes = new Set(Object.keys(redirects));
const searchIndex = JSON.parse(
  fs.readFileSync(path.join(DIST, "search-index.json"), "utf8")
);
const postRouteSet = new Set(
  searchIndex.map(post => new URL(post.url, SITE_ORIGIN).pathname)
);
const failures = [];

const sitemapRedirects = urls.filter(url => redirectRoutes.has(url));
if (sitemapRedirects.length) {
  failures.push(
    `Sitemap contains redirect routes: ${sitemapRedirects.slice(0, 10).join(", ")}`
  );
}

const compatibilityPostUrls = urls.filter(
  url => url.startsWith("/posts/") && url !== "/posts/"
);
if (compatibilityPostUrls.length) {
  failures.push(
    `Sitemap contains compatibility post URLs: ${compatibilityPostUrls
      .slice(0, 10)
      .join(", ")}`
  );
}

const postSitemapEntriesMissingLastmod = sitemap.filter(
  entry => postRouteSet.has(entry.pathname) && !entry.lastmod
);
if (postSitemapEntriesMissingLastmod.length) {
  failures.push(
    `Post sitemap entries missing lastmod: ${postSitemapEntriesMissingLastmod
      .slice(0, 10)
      .map(entry => entry.pathname)
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

const sitemapRedirectPages = pages.filter(
  page => page.redirect && urls.includes(page.route)
);
if (sitemapRedirectPages.length) {
  failures.push(
    `Sitemap contains rendered redirect pages: ${sitemapRedirectPages
      .slice(0, 10)
      .map(page => page.route)
      .join(", ")}`
  );
}

const missingCanonicalPosts = [...postRouteSet].filter(
  route => !urls.includes(route)
);
if (missingCanonicalPosts.length) {
  failures.push(
    `Canonical posts missing from sitemap: ${missingCanonicalPosts
      .slice(0, 10)
      .join(", ")}`
  );
}

const redirectChains = Object.entries(redirects).filter(
  ([, destination]) => destination in redirects
);
if (redirectChains.length) {
  failures.push(
    `Redirect chains remain: ${redirectChains
      .slice(0, 10)
      .map(([source, destination]) => `${source} -> ${destination}`)
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

const routeSet = new Set(pages.map(page => page.route));
const internalHrefFailures = [];

for (const page of pages) {
  if (page.redirect) continue;

  const baseUrl = new URL(page.route, SITE_ORIGIN);
  for (const href of page.hrefs) {
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      continue;
    }

    let url;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), baseUrl);
    } catch {
      continue;
    }

    if (url.origin !== SITE_ORIGIN) continue;

    const pathname = decodeURIComponent(url.pathname);
    const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;

    if (
      !routeSet.has(pathname) &&
      !routeSet.has(normalizedPath) &&
      !staticFileExists(pathname)
    ) {
      internalHrefFailures.push(`${page.route} -> ${pathname}`);
    }
  }
}

if (internalHrefFailures.length) {
  failures.push(
    `Broken internal anchor hrefs: ${internalHrefFailures
      .slice(0, 10)
      .join(", ")}`
  );
}

const postRoutes = urls.filter(url => postRouteSet.has(url)).length;
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
      brokenInternalHrefs: internalHrefFailures.length,
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
