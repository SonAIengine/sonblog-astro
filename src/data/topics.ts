export type Topic = {
  slug: "ai" | "search-engine" | "full-stack" | "devops";
  title: string;
  eyebrow: string;
  description: string;
  tags: string[];
  featuredIds: string[];
  learningPath: Array<{
    title: string;
    description: string;
    postIds: string[];
  }>;
};

export const topics: Topic[] = [
  {
    slug: "ai",
    title: "AI / LLM Engineering",
    eyebrow: "LLM Serving · RAG · MCP Agent",
    description:
      "XGEN 플랫폼, LLM 서빙, RAG, MCP 기반 에이전트, 그래프 기반 도구 검색까지 실제 서비스 개발과 운영에서 나온 AI 엔지니어링 기록입니다.",
    tags: ["AI", "LLM", "XGEN", "RAG", "MCP", "AI Agent", "LLMOps"],
    featuredIds: [
      "ai/agent/graph-tool-call-llm-agent-graph-based-tool-search-engine",
      "ai/agent/graph-tool-call-v020-rpc-detection-plan-execute-compiler",
      "ai/XGEN/xgen-2-0-model-serving-integration-architecture-refactoring",
      "ai/XGEN/qdrant-hybrid-search-sparse-dense-vector-integration",
    ],
    learningPath: [
      {
        title: "모델과 검색 기반 다지기",
        description: "토큰화, Transformer, RAG 검색 구조를 먼저 잡습니다.",
        postIds: [
          "ai/deep-learning/tokenization",
          "ai/deep-learning/transformer-query-key-value",
          "ai/XGEN/iterative-rag-search-engine-impl",
        ],
      },
      {
        title: "LLM 서빙과 RAG 운영",
        description: "vLLM, 임베딩 서버, Qdrant 기반 검색 파이프라인을 봅니다.",
        postIds: [
          "ai/model-serve/vllm-vs-lmdeploy-vs-sglang",
          "ai/XGEN/embedding-model-serving-batch-size-optimization",
          "ai/XGEN/qdrant-hybrid-search-sparse-dense-vector-integration",
        ],
      },
      {
        title: "Agent와 Tool Retrieval",
        description:
          "MCP, 그래프 기반 도구 검색, 실행 계획 컴파일러로 이어집니다.",
        postIds: [
          "ai/agent/graph-tool-call-llm-agent-graph-based-tool-search-engine",
          "ai/agent/graph-tool-call-v020-rpc-detection-plan-execute-compiler",
          "ai/agent/gwanjong-mcp-ai-social-agent-mcp-system-design-impl",
        ],
      },
    ],
  },
  {
    slug: "search-engine",
    title: "Search Engine",
    eyebrow: "OpenSearch · Qdrant · Hybrid Search",
    description:
      "커머스 검색엔진 구축, OpenSearch 운영, Qdrant 벡터 검색, Rust 검색 API, 하이브리드 검색 품질 개선 경험을 모은 영역입니다.",
    tags: [
      "Search Engine",
      "검색엔진",
      "OpenSearch",
      "Qdrant",
      "벡터검색",
      "하이브리드검색",
      "Rust",
      "RAG",
    ],
    featuredIds: [
      "search-engine/rust-search/rust-commerce-search-engine-build",
      "search-engine/rust-search/axum-opensearch-rust-search-api-architecture-design",
      "search-engine/nestjs-search/semantic-search-keyword-search-hybrid-strategy",
      "search-engine/semantic-search/vector-semantic-search",
    ],
    learningPath: [
      {
        title: "검색엔진 기본기",
        description:
          "OpenSearch 인덱스, BM25, 분석기, 검색 API 구조를 정리합니다.",
        postIds: [
          "search-engine/OpenSearch/opensearch-3-1-0-summary",
          "search-engine/OpenSearch/hybrid-search",
          "search-engine/rust-search/axum-opensearch-rust-search-api-architecture-design",
        ],
      },
      {
        title: "벡터 검색과 RAG",
        description: "Qdrant, 벡터 인덱싱, 시맨틱 검색 품질을 연결합니다.",
        postIds: [
          "search-engine/Qdrant/capacity-planning",
          "search-engine/Qdrant/indexing",
          "search-engine/semantic-search/vector-semantic-search",
        ],
      },
      {
        title: "프로덕션 검색 품질",
        description:
          "커머스 검색, 하이브리드 전략, 랭킹 개선 사례로 마무리합니다.",
        postIds: [
          "search-engine/rust-search/rust-commerce-search-engine-build",
          "search-engine/nestjs-search/semantic-search-keyword-search-hybrid-strategy",
          "search-engine/nestjs-search/search-result-ranking-scoring-system-design",
        ],
      },
    ],
  },
  {
    slug: "full-stack",
    title: "Full Stack",
    eyebrow: "Rust Gateway · Tauri · Next.js",
    description:
      "AI 플랫폼을 실제 제품으로 만들기 위한 백엔드, 프론트엔드, 데스크톱 앱, 실시간 스트리밍, 워크플로우 UI 구현 기록입니다.",
    tags: [
      "Full Stack",
      "Backend",
      "Frontend",
      "Rust",
      "Tauri",
      "React",
      "Next.js",
      "SSE",
    ],
    featuredIds: [
      "full-stack/desktop/tauri-2-0-ai-desktop-app-build",
      "full-stack/backend/rust-api-gateway-build-jwt-validation-cors-proxy",
      "full-stack/frontend/next-js-based-ai-workflow-editor-build",
      "full-stack/poc/workstream-kb",
    ],
    learningPath: [
      {
        title: "백엔드와 API 경계",
        description: "Rust Gateway, 파일 업로드, 분산 상태 관리 흐름을 봅니다.",
        postIds: [
          "full-stack/backend/rust-api-gateway-build-jwt-validation-cors-proxy",
          "full-stack/backend/2gb-file-upload-proxy-body-size-config",
          "full-stack/backend/redis-based-sse-session-status-share-multi-pod-env",
        ],
      },
      {
        title: "프론트엔드 워크플로우",
        description:
          "AI 워크플로우 편집기, 실행 패널, 상태 피드백 UI를 묶습니다.",
        postIds: [
          "full-stack/frontend/next-js-based-ai-workflow-editor-build",
          "full-stack/frontend/custom-node-editor-drag-drop-edge-snapping-impl",
          "full-stack/frontend/workflow-execution-panel-validation-ui-pattern",
        ],
      },
      {
        title: "데스크톱 제품화",
        description:
          "Tauri, 원격 WebView, 로컬/원격 서비스 통합으로 확장합니다.",
        postIds: [
          "full-stack/desktop/tauri-2-0-ai-desktop-app-build",
          "full-stack/desktop/remote-webview-architecture-local-app-remote-server-integration",
          "full-stack/desktop/xgen-desktop-local-ollama-backend-auto-start-mcp-rag",
        ],
      },
    ],
  },
  {
    slug: "devops",
    title: "DevOps / Infra",
    eyebrow: "K3s · ArgoCD · Istio · Jenkins",
    description:
      "XGEN과 홈서버를 운영하며 쌓은 Kubernetes, K3s, GitOps, TLS, Jenkins, 멀티사이트 배포, 폐쇄망 배포 트러블슈팅 기록입니다.",
    tags: [
      "DevOps",
      "인프라",
      "Kubernetes",
      "K3s",
      "ArgoCD",
      "Docker",
      "Jenkins",
      "Istio",
    ],
    featuredIds: [
      "devops/infra/trial-zone-provisioner-self-service-multitenant-compose-edge-tls",
      "devops/infra/xgen-k3s-anatomy-1-docker-build-strategy",
      "devops/infra/xgen-multi-site-deploy-automation-codebase-n-client-site-ops",
      "devops/infra/reusable-gha-helm-k3s-generic-deploy-platform-setup",
    ],
    learningPath: [
      {
        title: "K3s 기반 플랫폼",
        description:
          "컨테이너 빌드, Kubernetes 오브젝트, Helm 설계를 순서대로 봅니다.",
        postIds: [
          "devops/infra/xgen-k3s-anatomy-1-docker-build-strategy",
          "devops/infra/xgen-k3s-anatomy-2-kubernetes-core-objects",
          "devops/infra/xgen-k3s-anatomy-3-helm-chart-design",
        ],
      },
      {
        title: "GitOps와 배포 자동화",
        description: "Jenkins, ArgoCD, reusable workflow를 연결합니다.",
        postIds: [
          "devops/infra/xgen-k3s-anatomy-4-cicd-jenkins-argocd",
          "devops/infra/reusable-gha-helm-k3s-generic-deploy-platform-setup",
          "devops/infra/argocd-multi-client-site-deploy-architecture-applicationset-trial-error-single-entry-point-design",
        ],
      },
      {
        title: "운영과 멀티사이트",
        description:
          "TLS, 멀티사이트 배포, 폐쇄망/홈서버 운영 문제를 다룹니다.",
        postIds: [
          "devops/infra/trial-zone-provisioner-self-service-multitenant-compose-edge-tls",
          "devops/infra/xgen-multi-site-deploy-automation-codebase-n-client-site-ops",
          "devops/infra/caddy-reverse-proxy-homeserver-https-automation-nginx-comparison",
        ],
      },
    ],
  },
];

export const topicBySlug = new Map(topics.map(topic => [topic.slug, topic]));
