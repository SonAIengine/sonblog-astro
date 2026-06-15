export type InternalLinkTarget = {
  slug: string;
  title: string;
  href: string;
  keywords: string[];
};

export const internalLinkTargets: InternalLinkTarget[] = [
  {
    slug: "ai",
    title: "AI / LLM Engineering",
    href: "/topics/ai/",
    keywords: [
      "LLM",
      "RAG",
      "MCP",
      "AI Agent",
      "LLM Agent",
      "vLLM",
      "임베딩",
      "모델 서빙",
      "에이전트",
    ],
  },
  {
    slug: "search-engine",
    title: "Search Engine",
    href: "/topics/search-engine/",
    keywords: [
      "OpenSearch",
      "Qdrant",
      "BM25",
      "Reranker",
      "하이브리드 검색",
      "벡터 검색",
      "시맨틱 검색",
      "검색엔진",
      "검색 API",
    ],
  },
  {
    slug: "full-stack",
    title: "Full Stack",
    href: "/topics/full-stack/",
    keywords: [
      "Rust",
      "Tauri",
      "React",
      "Next.js",
      "FastAPI",
      "SSE",
      "프론트엔드",
      "백엔드",
      "워크플로우 UI",
    ],
  },
  {
    slug: "devops",
    title: "DevOps / Infra",
    href: "/topics/devops/",
    keywords: [
      "Kubernetes",
      "K3s",
      "ArgoCD",
      "GitOps",
      "Docker",
      "Jenkins",
      "Istio",
      "Helm",
      "TLS",
      "인프라",
    ],
  },
];
