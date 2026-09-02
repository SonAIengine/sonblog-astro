import {
  defineConfig,
  envField,
  fontProviders,
  svgoOptimizer,
} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 옛 MkDocs URL → 새 Astro URL SEO 리다이렉트 (scripts/build-redirects.mjs 생성)
import seoRedirects from "./src/redirects.generated.json";
import mdx from "@astrojs/mdx";
import sitemap, { ChangeFreqEnum, type SitemapItem } from "@astrojs/sitemap";
import { unified } from "@astrojs/markdown-remark";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import rehypeCallouts from "rehype-callouts";
import { rehypeAutoInternalLinks } from "./src/utils/rehypeAutoInternalLinks";
import { remarkContentLinks } from "./src/utils/remarkContentLinks";
import { remarkD2 } from "./src/utils/remarkD2";
import { remarkMermaid } from "./src/utils/remarkMermaid";
import { remarkRecoverStrong } from "./src/utils/remarkRecoverStrong";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import { slugifyStr } from "./src/utils/slugify";
import config from "./astro-paper.config";

const SITE_ORIGIN = "https://infoedu.co.kr";
const BLOG_CONTENT_DIR = "src/content/posts";
const SITE_STRUCTURE_LASTMOD = "2026-09-01T15:00:00.000Z";
const SCHEDULED_POST_MARGIN =
  config.posts?.scheduledPostMargin ?? 15 * 60 * 1000;

const PRIMARY_SITEMAP_PATHS = new Set([
  "/",
  "/about/",
  "/archives/",
  "/portfolio/",
  "/posts/",
  "/topics/",
  "/topics/ai/",
  "/topics/devops/",
  "/topics/full-stack/",
  "/topics/search-engine/",
]);

type SitemapRouteMeta = {
  lastmod?: string;
  changefreq?: SitemapItem["changefreq"];
  priority?: number;
  canonicalURL?: string;
};

function walkPostFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkPostFiles(fullPath);
    return /\.(md|mdx)$/i.test(entry.name) && !entry.name.startsWith("_")
      ? [fullPath]
      : [];
  });
}

function frontmatterOf(source: string) {
  return source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}

function frontmatterValue(frontmatter: string, key: string) {
  const value = frontmatter
    .match(new RegExp(`^${key}:\\s*(.+)\\s*$`, "m"))?.[1]
    ?.trim();

  return value?.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatterDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function postRoutePathFromFile(file: string) {
  const relative = path
    .relative(path.resolve(BLOG_CONTENT_DIR), file)
    .replace(/\\/g, "/")
    .replace(/\.(md|mdx)$/i, "");
  const segments = relative.split("/").filter(Boolean);
  const postSlug = segments.pop();
  if (!postSlug) return undefined;

  const categorySegments = segments
    .filter(segment => !segment.startsWith("_"))
    .map(segment => slugifyStr(segment));

  return `/posts/${[...categorySegments, postSlug].join("/")}/`;
}

function isRecent(lastmod: string, days: number) {
  const modifiedAt = new Date(lastmod).getTime();
  return Date.now() - modifiedAt < days * 24 * 60 * 60 * 1000;
}

function latestISODate(...values: (string | undefined)[]) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

function buildPostSitemapMetadata() {
  const metadata = new Map<string, SitemapRouteMeta>();
  const root = path.resolve(BLOG_CONTENT_DIR);

  for (const file of walkPostFiles(root)) {
    const frontmatter = frontmatterOf(fs.readFileSync(file, "utf8"));
    const draft = frontmatterValue(frontmatter, "draft")?.toLowerCase();
    const pubDatetime = parseFrontmatterDate(
      frontmatterValue(frontmatter, "pubDatetime")
    );
    const modDatetime = parseFrontmatterDate(
      frontmatterValue(frontmatter, "modDatetime")
    );
    const routePath = postRoutePathFromFile(file);

    if (!routePath || draft === "true" || !pubDatetime) continue;
    if (Date.now() <= pubDatetime.getTime() - SCHEDULED_POST_MARGIN) continue;

    const lastmod = latestISODate(
      (modDatetime ?? pubDatetime).toISOString(),
      SITE_STRUCTURE_LASTMOD
    );
    if (!lastmod) continue;

    metadata.set(routePath, {
      lastmod,
      changefreq: isRecent(lastmod, 45)
        ? ChangeFreqEnum.WEEKLY
        : ChangeFreqEnum.MONTHLY,
      priority: isRecent(lastmod, 90) ? 0.8 : 0.65,
      canonicalURL: frontmatterValue(frontmatter, "canonicalURL"),
    });
  }

  return metadata;
}

const postSitemapMetadata = buildPostSitemapMetadata();
const latestPostLastmod = latestISODate(
  SITE_STRUCTURE_LASTMOD,
  ...[...postSitemapMetadata.values()].map(meta => meta.lastmod)
);

const staticSitemapMetadata = new Map<string, SitemapRouteMeta>([
  [
    "/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.DAILY,
      priority: 1,
    },
  ],
  [
    "/posts/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.DAILY,
      priority: 0.95,
    },
  ],
  [
    "/topics/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.85,
    },
  ],
  [
    "/topics/ai/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.85,
    },
  ],
  [
    "/topics/devops/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.8,
    },
  ],
  [
    "/topics/full-stack/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.8,
    },
  ],
  [
    "/topics/search-engine/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.8,
    },
  ],
  ["/portfolio/", { changefreq: ChangeFreqEnum.MONTHLY, priority: 0.75 }],
  ["/about/", { changefreq: ChangeFreqEnum.MONTHLY, priority: 0.6 }],
  [
    "/archives/",
    {
      lastmod: latestPostLastmod,
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.6,
    },
  ],
]);

function canonicalMatchesPage(pathname: string, canonicalURL: string) {
  try {
    const canonical = new URL(canonicalURL, SITE_ORIGIN);
    return (
      canonical.origin === SITE_ORIGIN &&
      canonical.pathname.replace(/\/?$/, "/") === pathname
    );
  } catch {
    return false;
  }
}

function isPrimarySitemapPage(page: string) {
  const pathname = new URL(page).pathname;

  if (pathname in seoRedirects) return false;
  if (config.features?.showArchives === false && pathname === "/archives/") {
    return false;
  }

  if (PRIMARY_SITEMAP_PATHS.has(pathname)) return true;

  if (pathname.startsWith("/posts/") && !/^\/posts\/\d+\/?$/.test(pathname)) {
    const meta = postSitemapMetadata.get(pathname);
    if (!meta) return false;
    return (
      !meta.canonicalURL || canonicalMatchesPage(pathname, meta.canonicalURL)
    );
  }

  return false;
}

function serializeSitemapItem(item: SitemapItem): SitemapItem {
  const pathname = new URL(item.url).pathname;
  const meta =
    postSitemapMetadata.get(pathname) ?? staticSitemapMetadata.get(pathname);

  if (!meta) return item;

  return {
    ...item,
    lastmod: meta.lastmod ?? item.lastmod,
    changefreq: meta.changefreq ?? item.changefreq,
    priority: meta.priority ?? item.priority,
  };
}

export default defineConfig({
  site: "https://infoedu.co.kr",
  base: "/",
  redirects: seoRedirects,
  trailingSlash: "ignore",
  integrations: [
    mdx(),
    sitemap({
      filter: isPrimarySitemapPage,
      serialize: serializeSitemapItem,
      namespaces: {
        news: false,
        xhtml: false,
        image: false,
        video: false,
      },
    }),
  ],
  i18n: {
    locales: ["ko"],
    defaultLocale: "ko",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [
        remarkToc,
        [remarkCollapse, { test: "Table of contents" }],
        remarkContentLinks,
        remarkRecoverStrong,
        remarkD2,
        remarkMermaid,
      ],
      rehypePlugins: [rehypeCallouts, rehypeAutoInternalLinks],
    }),
    shikiConfig: {
      themes: { light: "min-light", dark: "night-owl" },
      defaultColor: false,
      wrap: false,
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // The graph page is intentionally powered by lazy-loaded Cosmograph/WebGL.
      chunkSizeWarningLimit: 900,
    },
    resolve: {
      alias: {
        // Cosmograph 내부 텔레메트리(Supabase 전송) 차단 + 번들 경량화
        "@supabase/supabase-js": fileURLToPath(
          new URL("./src/utils/supabase-stub.js", import.meta.url)
        ),
      },
    },
  },
  fonts: [
    {
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.google(),
      // 라틴/숫자는 Sans Code. 한글은 이 폰트에 글리프가 없어 다음 폰트(Pretendard)로
      // 넘어간다 → Windows에서 monospace(굴림)로 깨지던 문제 해결.
      // Pretendard는 Layout.astro에서 CDN(dynamic-subset)으로 로드하며 family명이 "Pretendard".
      fallbacks: [
        "Pretendard",
        "Apple SD Gothic Neo",
        "Malgun Gothic",
        "monospace",
      ],
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      formats: ["woff2"],
    },
  ],
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  experimental: {
    svgOptimizer: svgoOptimizer(),
  },
});
