import {
  defineConfig,
  envField,
  fontProviders,
  svgoOptimizer,
} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
// 옛 MkDocs URL → 새 Astro URL SEO 리다이렉트 (scripts/build-redirects.mjs 생성)
import seoRedirects from "./src/redirects.generated.json";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
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
import config from "./astro-paper.config";

export default defineConfig({
  site: "https://infoedu.co.kr",
  base: "/",
  redirects: seoRedirects,
  trailingSlash: "ignore",
  integrations: [
    mdx(),
    sitemap({
      filter: page => {
        const pathname = new URL(page).pathname;
        return (
          !(pathname in seoRedirects) &&
          (config.features?.showArchives !== false ||
            !page.endsWith("/archives/"))
        );
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
