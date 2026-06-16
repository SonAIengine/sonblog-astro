import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://infoedu.co.kr/",
    title: "SON BLOG",
    description: "AI Engineer 손성준 · LLM Serving, RAG, Rust, K8s — 검색엔진/AI/DevOps 기술 블로그",
    author: "손성준",
    profile: "https://github.com/SonAIengine",
    ogImage: "default-og.jpg",
    lang: "ko",
    timezone: "Asia/Seoul",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: false,
    showArchives: true,
    showBackButton: true,
    editPost: { enabled: false },
    search: "pagefind",
  },
  analytics: {
    goatCounter: {
      code: "sonblog",
    },
  },
  socials: [
    { name: "github", url: "https://github.com/SonAIengine" },
    { name: "mail", url: "mailto:sonsj97@gmail.com" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x",        url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
