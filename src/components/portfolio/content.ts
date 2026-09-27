// Portfolio page copy. Both locales share PortfolioPage.astro; only text lives here.
// Numbers must match the resume master (career-profiles/resume-2026-09/master_v5.md).

export type Link = { label: string; href: string };
export type Stat = { value: string; label: string };
export type Project = {
  title: string;
  period: string;
  ownership: string;
  summary: string;
  points: { k?: string; v: string }[];
  evidence?: string;
  evidenceLink?: Link;
  posts: Link[];
  stack?: string[];
  metric?: { value: string; label: string };
  figure?: {
    src: string;
    alt: string;
    caption: string;
    width: number;
    height: number;
    mobileSrc?: string;
  };
  badges?: string[];
  wide?: boolean;
};

export type PortfolioCopy = {
  lang: "ko" | "en";
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    name: string;
    role: string;
    summary: string[];
    mailSubject: string;
    ctaMail: string;
    ctaPdf: string;
    note: string;
    langSwitch: Link;
  };
  fit: { title: string; items: { title: string; body: string }[] };
  glance: {
    label: string;
    rows: { k: string; v: string }[];
    mail: string;
    pdfLabel: string;
    pdfDesc: string;
    pdfOpen: string;
    pdfDownload: string;
    pdfFilename: string;
    pdfAria: string;
    pdfAlt: string;
  };
  projects: {
    title: string;
    featuredLabel: string;
    postsLabel: string;
    moreLabel: string;
    featured: Project;
    cards: Project[];
  };
  experience: {
    title: string;
    items: {
      company: string;
      role: string;
      period: string;
      bullets: string[];
    }[];
  };
  oss: {
    title: string;
    items: { name: string; href: string; desc: string; badge: string }[];
    writingTitle: string;
    writingDesc: (n: number) => string;
    allPosts: Link;
  };
  skills: { title: string; rows: { label: string; items: string[] }[] };
  edu: {
    title: string;
    schools: { period: string; school: string; degree: string }[];
    certsLabel: string;
    certs: string[];
  };
  cta: { title: string; body: string[]; mail: string; pdf: string };
};

const P = {
  applicationset:
    "/devops/infra/argocd-multi-client-site-deploy-architecture-applicationset-trial-error-single-entry-point-design/",
  rocm: "/ai/XGEN/llama-cpp-server-ops-story-rocm-gpu-troubleshoot-fix/",
  multinode:
    "/devops/infra/xgen-model-multinode-gpu-serving-daemonset-headless-routing/",
  stall: "/ai/agent/ai-agent-conversation-stall-detection-replay-canary/",
  gtc: "/ai/agent/graph-tool-call-llm-agent-graph-based-tool-search-engine/",
  gtcBench:
    "/ai/agent/graph-tool-call-v015-workflow-chain-competitive-benchmark/",
  hybrid:
    "/search-engine/nestjs-search/semantic-search-keyword-search-hybrid-strategy/",
  indexing:
    "/search-engine/rust-search/opensearch-indexing-service-streaming-vs-batch-processing-comparison/",
  aiSearchCase: "/portfolio/search/ai-search-setup-case/",
  gliner: "/ai/fine-tuning/gliner-dpo-lora-finetuning/",
};

/** Every internal post link used on the page, checked against real posts at build time. */
export const POST_LINKS = Object.values(P);

export const ko: PortfolioCopy = {
  lang: "ko",
  meta: {
    title: "손성준 포트폴리오 | FDE, AI 플랫폼 엔지니어",
    description:
      "AI 에이전트 플랫폼 XGEN의 모델 서빙과 배포를 맡고 8명 파트를 이끄는 손성준의 포트폴리오. 배포 플랫폼, 에이전트 하네스 평가, 고객 현장(FDE), 오픈소스 graph-tool-call.",
  },
  hero: {
    eyebrow: "Forward Deployed Engineer · AI Platform",
    name: "손성준",
    role: "(주)플래티어 AI R&D팀 기술·컨설팅 파트장",
    summary: [
      "고객사에 들어가 AI 에이전트를 실제 업무에 붙이는 FDE입니다.",
      "요구를 듣고 에이전트를 만들어 고객 서버와 폐쇄망에 배포하고, 그걸 받치는 LLM 서빙·배포 플랫폼도 직접 만들었습니다.",
    ],
    mailSubject: "[포트폴리오 보고 연락] ",
    ctaMail: "이메일로 연락하기",
    ctaPdf: "포트폴리오 PDF",
    note: "FDE, LLM 서빙·배포, AI 에이전트 플랫폼 포지션 제안과 커피챗을 환영합니다.",
    langSwitch: { label: "English", href: "/portfolio-en/" },
  },
  fit: {
    title: "이런 일을 맡길 수 있습니다",
    items: [
      {
        title: "고객 현장에 AI 에이전트 붙이기 (FDE)",
        body: "고객사 30여 곳의 시연과 PoC를 맡아 5곳을 계약으로 이어 갔습니다. 지방은행 프로젝트에는 FDE로 들어가 권한, 감사 로그, SSO 같은 금융권 요건을 맞추며 에이전트를 만들고 사용자 교육을 했습니다. 지금은 8명 기술·컨설팅 파트를 이끕니다.",
      },
      {
        title: "LLM 서빙과 배포 플랫폼",
        body: "GPU 서버마다 모델을 올리고, 온프레미스 고객사 서버와 폐쇄망에 같은 방식으로 배포하는 구조를 설계하고 운영합니다. vLLM, llama.cpp, K3s, Helm, ArgoCD를 씁니다.",
      },
      {
        title: "AI 에이전트 실행 품질",
        body: "LangChain·LangGraph로 XGEN 에이전트와 챗봇을 만들었고, 지금은 그 실행 경로를 자체 하네스로 옮기며 튜닝과 평가를 맡고 있습니다. 에이전트가 도중에 멈추거나 완료를 거짓으로 보고하는 문제를 공개 벤치마크로 재고, 개선용과 검증용 과제에서 모두 좋아진 변경만 반영합니다.",
      },
    ],
  },
  glance: {
    label: "At a glance",
    rows: [
      { k: "현재", v: "(주)플래티어 AI R&D팀 파트장 (직급 대리), 2024.03 ~" },
      { k: "팀", v: "8명 파트 · 기술·컨설팅" },
      { k: "경력", v: "2021.07 ~ 현재 (2021.07 ~ 2022.12 인턴)" },
      { k: "학력", v: "고려대 SW·AI융합대학원 인공지능융합학과 석사과정" },
      { k: "연락", v: "sonsj97@gmail.com" },
    ],
    mail: "이메일",
    pdfLabel: "포트폴리오 PDF · 26쪽",
    pdfDesc: "프로젝트별 문제, 판단, 결과를 그림과 함께 정리 · 2026.09",
    pdfOpen: "새 창으로 보기",
    pdfDownload: "다운로드",
    pdfFilename: "손성준_포트폴리오_2026.pdf",
    pdfAria: "포트폴리오 PDF 새 창으로 열기",
    pdfAlt: "손성준 포트폴리오 2026 표지",
  },
  projects: {
    title: "대표 프로젝트",
    featuredLabel: "Featured",
    postsLabel: "관련 글",
    moreLabel: "서빙 · 장애 · 운영 더 보기",
    featured: {
      title: "XGEN 배포 플랫폼과 모델 서빙",
      metric: { value: "8개 환경", label: "공통 차트 수정 0회로 운영" },
      figure: {
        src: "/portfolio/fig-deploy.jpg",
        width: 1600,
        height: 1196,
        mobileSrc: "/portfolio/fig-deploy-m.jpg",
        alt: "중앙 배포에서 서버별 Helm 차트 구조로 바꾼 배포 구조도",
        caption:
          "중앙 배포(철회)와 서버별 Helm 차트(현재) · 포트폴리오 PDF 8쪽",
      },
      period: "2025.06 ~ 현재 · 2026.01부터 주도",
      ownership: "직접 설계·구현 (앱 서비스는 파트원 담당)",
      summary:
        "XGEN은 금융·커머스 고객사에 공급되는 기업용 AI 에이전트 플랫폼입니다(2026.07 TTA GS 1등급). 앱 서비스는 파트원들이 나눠 맡고, 저는 어느 서버에서든 같은 방식으로 올리는 배포 플랫폼과 GPU 모델 서빙을 맡았습니다.",
      points: [
        {
          k: "문제",
          v: "고객사 서버, 폐쇄망, GPU 종류가 늘 때마다 배포 설정이 갈라졌습니다.",
        },
        {
          k: "판단",
          v: "ArgoCD ApplicationSet 중앙 배포를 도입했다가, 서버마다 배포 도구가 있는 구조와 맞지 않아 한 달 만에 되돌리고 Helm 차트 하나에 서버별 설정 파일만 두는 구조로 바꿨습니다.",
        },
        {
          k: "결과",
          v: "고객사 3곳과 사내 5개, 8개 환경을 같은 차트로 운영합니다. 환경 6곳을 늘리는 동안 공통 차트는 한 번도 고치지 않았습니다.",
        },
        {
          k: "서빙",
          v: "GPU 서버마다 모델 서버를 자동으로 띄우고, 요청은 모델이 올라간 서버로 보냅니다. 실행 엔진 10종, 모델 7종(LLM, 임베딩, 음성 등)을 관리 화면에서 다룹니다.",
        },
        {
          k: "장애",
          v: "AMD GPU에서 llama.cpp가 로드 직후 멈추는 문제를 약 6시간 동안 좁혀 ROCm 드라이버 문제로 확인하고 Vulkan으로 바꿨습니다. 이후 GPU 종류별로 실행 엔진을 자동 선택합니다.",
        },
        {
          k: "운영",
          v: "문서 처리 서비스 최대 메모리 약 47% 감소(2,257MB → 1,204MB). 11개 저장소에 개발·검증·운영 3단계 배포와 MR별 미리보기 서버를 넣었습니다.",
        },
      ],
      evidence:
        "근거 · 배포 저장소 커밋 962/1,069 (90%), 모델 서빙 저장소 커밋 189/218 (86%), 2026.09 집계 · 관리 화면과 구조도는 포트폴리오 PDF에",
      posts: [
        {
          label: "ApplicationSet 시행착오와 서버별 배포 구조",
          href: P.applicationset,
        },
        { label: "llama.cpp 서버 운영기: ROCm GPU 문제 해결", href: P.rocm },
        { label: "멀티노드 GPU 서빙 구조", href: P.multinode },
      ],
      stack: [
        "FastAPI",
        "K3s",
        "Helm",
        "ArgoCD",
        "vLLM",
        "llama.cpp",
        "PostgreSQL",
        "Valkey",
        "Qdrant",
        "MinIO",
        "Grafana",
      ],
    },
    cards: [
      {
        title: "지방은행 생성형 AI 플랫폼",
        wide: true,
        metric: { value: "사용자 500명", label: "현장 배치, 사용자 교육 5회" },
        badges: [
          "권한 체계 개편",
          "감사 로그",
          "관리자 IP 접근 제어",
          "SSO 연동",
          "쓰기 SQL 차단",
          "Oracle 연동",
        ],
        period: "FDE (현장 배치 엔지니어)",
        ownership: "에이전트 개발 · 고객 커뮤니케이션 · 교육",
        summary:
          "지방은행 생성형 AI 플랫폼에 들어가 에이전트를 직접 만들고, 고객 커뮤니케이션과 사용자 교육을 맡았습니다.",
        points: [
          {
            v: "에이전트 라우터, 실패 로그 화면, SQL 조회 결과를 답변에 결합",
          },
          {
            v: "고객 서버 배포와 모델 서빙 운영 (GPU 메모리 기반 적재 제어, 장애 자동 복구)",
          },
        ],
        posts: [],
      },
      {
        title: "에이전트 하네스 튜닝과 평가",
        metric: {
          value: "8.21 → 4.5회대",
          label: "작업당 LLM 호출, 평가 점수 유지",
        },
        figure: {
          src: "/portfolio/fig-harness.jpg",
          width: 770,
          height: 980,
          alt: "작업당 AI 호출 횟수와 평가 점수 비교 차트",
          caption: "작업당 AI 호출, 70과제 평균 · 포트폴리오 PDF 22쪽",
        },
        period: "2026.08 ~ 현재",
        ownership: "튜닝·평가 담당 (실행 파이프라인 설계는 동료)",
        summary:
          "하네스는 모델 바깥에서 도구 호출, 권한, 완료 판정을 통제하는 계층입니다. 실사용 요청의 약 8%가 도중에 멈추는 문제에서 시작했습니다.",
        points: [
          {
            v: "Qihoo360이 공개한 Harness-Bench를 연동하고, 70과제를 개선용 39개와 검증용 31개로 나눠 두 쪽 모두 좋아진 변경만 반영",
          },
          {
            v: "작업당 LLM 호출 평균 8.21회 → 4.5회대(개발 환경, 평가 점수는 같은 설정 4회 반복 범위 안), 거짓 완료 보고 60회 검사 중 0건, 기본 프롬프트 37% 축소",
          },
          {
            v: '"도구를 묶어 호출하라" 같은 지시문은 38과제 중 1번만 지켜져 기각하고, 구조로 강제하는 변경 5건만 채택. 빠른 경로는 초안을 AI 코딩 도구(Claude Code, Codex)로 만들고 이식·검증·배포는 직접 함',
          },
          {
            v: "실행 로그 2만 건을 점검해 비밀번호·토큰 노출 34건을 가림 처리",
          },
        ],
        evidenceLink: {
          label: "벤치마크 출처 · github.com/Qihoo360/harness-bench",
          href: "https://github.com/Qihoo360/harness-bench",
        },
        posts: [{ label: "대화 정체 감지와 재생 카나리", href: P.stall }],
      },
      {
        title: "graph-tool-call",
        metric: { value: "9,094회", label: "최근 6개월 PyPI 다운로드" },
        figure: {
          src: "/portfolio/fig-toolsearch.jpg",
          width: 1400,
          height: 795,
          alt: "준비 단계 도구 발견율 14.3%에서 100%, 전달 토큰 1,476에서 160으로 줄어든 막대 그래프",
          caption: "준비 단계 도구 발견율과 전달 토큰 · 포트폴리오 PDF 16쪽",
        },
        period: "2026.03 ~ · 오픈소스",
        ownership: "단독 설계·개발 (커밋 96%)",
        summary:
          "의미 검색은 목표 도구(환불)는 찾지만 그 입력값을 만들어 줄 도구(주문 조회)를 놓쳤습니다. 도구 간 입력·출력 관계를 그래프로 만들어 함께 찾습니다.",
        points: [
          {
            v: "재현 케이스 7개 중 1개에서만 찾던 사전 단계 도구를 7개 모두에서 찾음, 전달 토큰 1,476 → 160",
          },
          {
            v: "도구 1,068개 실험에서 그래프를 점수에 섞어도 좋아지지 않는다는 결과를 공개하고 설계를 바꿈",
          },
          { v: "PyPI 57회 릴리스, 최근 6개월 다운로드 9,094회, GeekNews 소개" },
        ],
        posts: [
          { label: "그래프 기반 도구 검색 엔진", href: P.gtc },
          { label: "1,068개 도구 스트레스 테스트", href: P.gtcBench },
        ],
      },
      {
        title: "LLM 파인튜닝",
        metric: {
          value: "14B",
          label: "한국어 LLM POLAR, SFT·DPO(선호 데이터 1.23만 건)",
        },
        period: "2024.04 ~ 06 · 2026.09 ~",
        ownership: "POLAR는 AI Lab 공동 개발, sev는 개인",
        summary:
          "입사 직후 플래티어 AI Lab에서 한국어 LLM POLAR를 공동으로 만들었고, 지금은 작은 결정 모델을 LoRA로 학습하고 있습니다.",
        points: [
          {
            v: "POLAR: SOLAR-10.7B 기반 14B 한국어 LLM, DeepSpeed로 SFT와 DPO(선호 데이터 1.23만 건) 학습, Hugging Face 공개와 리더보드 제출",
          },
          {
            v: "sev(2026.09 ~): Eikos 기반 Qwen3.5-4B LoRA 결정 모델의 데이터셋, 학습, 서빙, 평가를 한 하네스로 관리",
          },
        ],
        evidenceLink: {
          label: "Hugging Face · x2bee/POLAR-14B-DPO-v1.3",
          href: "https://huggingface.co/x2bee/POLAR-14B-DPO-v1.3",
        },
        posts: [{ label: "GliNER과 DPO-LoRA 파인튜닝", href: P.gliner }],
      },
      {
        title: "커머스 상품 검색",
        metric: {
          value: "10ms / 74ms",
          label: "검색 서버 / 앞단 API, 병목은 검색 서버 밖",
        },
        figure: {
          src: "/portfolio/fig-latency.jpg",
          width: 1400,
          height: 269,
          alt: "구간별 응답 시간 막대 그래프",
          caption: "구간별 응답 시간 · 포트폴리오 PDF 25쪽",
        },
        period: "2024.07 ~ 2026.04 · 2025.06부터 XGEN과 병행",
        ownership: "하이브리드 쿼리 설계 · Rust 전환 색인 담당",
        summary:
          '"빨간 여성 롱코트" 같은 문장형 검색어를 위해 키워드, 상품 벡터, 색상 벡터를 한 번에 묻는 OpenSearch 쿼리를 설계했습니다(NestJS, 커밋 323건).',
        points: [
          {
            v: "Rust 검색 API 전환 때 색인을 5만 건 단위 스트리밍으로 다시 짜고, 기존 일괄 처리 코드 8천여 줄 제거",
          },
          {
            v: "느리다는 외부 성능 시험 결과를 구간별로 재서, 검색 서버(평균 10ms)가 아니라 앞단 API(약 74ms)가 병목임을 확인",
          },
        ],
        posts: [
          { label: "시맨틱·키워드 하이브리드 전략", href: P.hybrid },
          { label: "색인: 스트리밍 vs 배치", href: P.indexing },
          { label: "교육 전문 쇼핑몰 AI 검색 적용 사례", href: P.aiSearchCase },
        ],
      },
    ],
  },
  experience: {
    title: "경력",
    items: [
      {
        company: "(주)플래티어",
        role: "AI R&D팀 파트장 (대리)",
        period: "2024.03 ~ 재직 중",
        bullets: [
          "커머스 검색 개발로 입사, 2025.06부터 XGEN 담당, 2026.06 조직개편 후 기술·컨설팅 파트장",
          "2024 한국어 LLM POLAR 파인튜닝(SFT·DPO) 공동 수행, 2025 XGEN 1.0 LangChain 노드, 2026 LangGraph 기반 AI 챗봇 개발",
          "XGEN 배포 플랫폼과 모델 서빙 설계·구현, 게이트웨이(Rust) 인증·라우팅, TTA GS 성능시험 환경 구축",
          "11개 저장소에 3단계 배포, MR별 미리보기 서버, AI 코드 리뷰 도입",
          "고객사 30여 곳 시연·PoC·기술 컨설팅(5곳 계약), Intel Gaudi2/3 LLM 추론 PoC 공동 수행",
          "8명 파트 업무 배분, 코드 리뷰, AI 개발자 채용 면접",
        ],
      },
      {
        company: "서울아이알네트워크",
        role: "플랫폼사업부 매니저",
        period: "2023.02 ~ 2024.02",
        bullets: [
          "IR 대시보드 SaaS(IRUP) 개편·운영: 12개 고객사 대상 뉴스·유튜브·리포트 클리핑, 중복 기사 묶음, 알림, 주가 연동 대시보드",
          "사내 전자결재 시스템 단독 개발 (Next.js, Node.js, Firebase)",
        ],
      },
      {
        company: "에이치제이브레인",
        role: "데이터 엔지니어 (인턴)",
        period: "2021.07 ~ 2022.12",
        bullets: [
          "뉴스·애널리스트 리포트·공시 크롤러 개발과 운영, 중복 기사 제거, 수집 모니터링 대시보드",
        ],
      },
    ],
  },
  oss: {
    title: "오픈소스와 글",
    items: [
      {
        name: "graph-tool-call",
        href: "https://github.com/SonAIengine/graph-tool-call",
        desc: "LLM 에이전트용 도구 검색. 필요한 도구와 사전 단계 도구를 함께 찾고, MCP 서버나 여러 MCP 서버를 묶는 프록시로도 씁니다.",
        badge: "pip install graph-tool-call",
      },
      {
        name: "synaptic-memory",
        href: "https://github.com/PlateerLab/synaptic-memory",
        desc: "에이전트용 지식 그래프 메모리. RAG-ko MRR 0.947.",
        badge: "pip install synaptic-memory",
      },
      {
        name: "ku-portal-mcp",
        href: "https://github.com/SonAIengine/ku-portal-mcp",
        desc: "고려대 포털을 MCP 서버로 직접 설계해 PyPI로 배포. 외부 기여 PR 2건.",
        badge: "pip install ku-portal-mcp",
      },
    ],
    writingTitle: "최근 글",
    writingDesc: n =>
      `기술 블로그에 ${Math.floor(n / 10) * 10}편 넘게 썼습니다. 만든 것과 실패한 것을 같이 남깁니다.`,
    allPosts: { label: "전체 글 보기", href: "/posts/" },
  },
  skills: {
    title: "기술",
    rows: [
      {
        label: "AI · LLM",
        items: ["vLLM", "llama.cpp", "MCP", "RAG", "Qdrant", "OpenSearch"],
      },
      {
        label: "Infra",
        items: [
          "Kubernetes (K3s)",
          "Helm",
          "ArgoCD",
          "Docker",
          "Jenkins",
          "Grafana",
        ],
      },
      { label: "Language", items: ["Python", "Rust", "TypeScript"] },
      {
        label: "Agent",
        items: ["LangChain", "LangGraph", "MCP", "Tool calling"],
      },
      { label: "Training", items: ["DeepSpeed", "TRL (SFT · DPO)", "LoRA"] },
      { label: "AI Coding", items: ["Claude Code", "Codex"] },
      { label: "Framework", items: ["FastAPI", "Axum", "NestJS", "Next.js"] },
      { label: "Data", items: ["PostgreSQL", "Valkey · Redis", "MinIO"] },
    ],
  },
  edu: {
    title: "학력과 자격",
    schools: [
      {
        period: "2026.03 ~",
        school: "고려대학교 SW·AI융합대학원",
        degree: "인공지능융합학과 석사과정",
      },
      {
        period: "2021.02 ~ 2023.02",
        school: "한양대학교",
        degree: "도시공학과 학사 (편입)",
      },
      { period: "2019.08", school: "학점은행제", degree: "컴퓨터공학 학사" },
    ],
    certsLabel: "자격",
    certs: [
      "정보처리산업기사 (2018.11)",
      "네트워크관리사 2급 (2019.04)",
      "SQLD (2023.04)",
      "ADsP (2023.06)",
    ],
  },
  cta: {
    title: "함께 이야기해 보고 싶다면",
    body: [
      "포지션 제안, 커피챗, 기술 질문 모두 좋습니다.",
      "LLM 서빙·배포 구조나 에이전트 신뢰성 문제를 같이 풀 팀이라면 더 반갑습니다.",
    ],
    mail: "sonsj97@gmail.com 로 메일 보내기",
    pdf: "포트폴리오 PDF",
  },
};

export const en: PortfolioCopy = {
  lang: "en",
  meta: {
    title:
      "Sungjun Son Portfolio | AI Platform Engineer, LLM Serving and AI Agents",
    description:
      "Portfolio of Sungjun Son, who runs model serving and deployment for the XGEN AI agent platform and leads an 8-person part: deployment platform, agent harness evaluation, on-site FDE work, and the open-source graph-tool-call.",
  },
  hero: {
    eyebrow: "Forward Deployed Engineer · AI Platform",
    name: "Sungjun Son",
    role: "Tech & Consulting Part Leader, AI R&D Team at Plateer",
    summary: [
      "I am a forward deployed engineer who puts AI agents to work inside customer companies.",
      "I take requirements, build the agents, deploy them to customer servers and air-gapped networks, and built the LLM serving and deployment platform underneath.",
    ],
    mailSubject: "[From your portfolio] ",
    ctaMail: "Email me",
    ctaPdf: "Portfolio PDF",
    note: "Open to roles and coffee chats on FDE work, LLM serving and deployment, and AI agent platforms.",
    langSwitch: { label: "한국어", href: "/portfolio/" },
  },
  fit: {
    title: "What you can hand me",
    items: [
      {
        title: "Putting AI agents to work on customer sites (FDE)",
        body: "I led demos and PoCs for about 30 customers and turned 5 into contracts. On site as an FDE for a regional bank, I built agents and trained users while meeting banking requirements such as permissions, audit logs, and SSO. I now lead an 8-person tech and consulting part.",
      },
      {
        title: "LLM serving and deployment platforms",
        body: "I design and run the setup that puts models on every GPU server and deploys the same way to on-premises customer servers and air-gapped networks. vLLM, llama.cpp, K3s, Helm, ArgoCD.",
      },
      {
        title: "AI agent execution quality",
        body: "I built XGEN agents and chatbots on LangChain and LangGraph, and now tune and evaluate the in-house harness that replaces that execution path. I measure agents that stall midway or falsely report completion on a public benchmark, and ship only changes that improve both the tuning split and the held-out split.",
      },
    ],
  },
  glance: {
    label: "At a glance",
    rows: [
      {
        k: "Now",
        v: "Part Leader (Assistant Manager grade), AI R&D Team at Plateer, since 2024.03",
      },
      { k: "Team", v: "8-person part · Tech & Consulting" },
      { k: "Career", v: "2021.07 to present (2021.07 to 2022.12 as intern)" },
      { k: "Edu", v: "M.S. student, AI Convergence, Korea University" },
      { k: "Contact", v: "sonsj97@gmail.com" },
    ],
    mail: "Email",
    pdfLabel: "Portfolio PDF · 26 pages",
    pdfDesc:
      "Problem, decision, and result per project, with diagrams · Korean · 2026.09",
    pdfOpen: "Open",
    pdfDownload: "Download",
    pdfFilename: "Sungjun_Son_Portfolio_2026.pdf",
    pdfAria: "Open the portfolio PDF in a new tab",
    pdfAlt: "Cover of Sungjun Son portfolio 2026",
  },
  projects: {
    title: "Selected projects",
    featuredLabel: "Featured",
    postsLabel: "Posts",
    moreLabel: "Serving, incident, ops",
    featured: {
      title: "XGEN deployment platform and model serving",
      metric: {
        value: "8 environments",
        label: "run with zero shared-chart changes",
      },
      figure: {
        src: "/portfolio/fig-deploy.jpg",
        width: 1600,
        height: 1196,
        mobileSrc: "/portfolio/fig-deploy-m.jpg",
        alt: "Deployment diagram from central push to per-server Helm charts",
        caption:
          "Central push (rolled back) vs per-server Helm chart (current) · PDF p.8 (Korean)",
      },
      period: "2025.06 to present · leading since 2026.01",
      ownership: "Designed and built by me (app services owned by teammates)",
      summary:
        "XGEN is an enterprise AI agent platform supplied to finance and commerce customers (TTA GS Grade 1, 2026.07). Teammates own the app services; I own the deployment platform that ships them the same way to any server, and GPU model serving.",
      points: [
        {
          k: "Problem",
          v: "Deployment configs kept forking as customer servers, air-gapped sites, and GPU types multiplied.",
        },
        {
          k: "Decision",
          v: "I introduced central deployment with ArgoCD ApplicationSet, rolled it back after a month because every server already had its own deploy tool, and moved to one Helm chart plus a per-server values file.",
        },
        {
          k: "Result",
          v: "8 environments (3 customers, 5 internal) run on the same chart. The shared chart was not modified once while 6 environments were added.",
        },
        {
          k: "Serving",
          v: "A model server starts on every GPU node and requests go to the node that holds the model. 10 runtimes and 7 model types (LLM, embedding, speech, and more) are managed from one screen.",
        },
        {
          k: "Incident",
          v: "Traced llama.cpp hanging right after load on AMD GPUs to the ROCm driver over about 6 hours and switched to Vulkan. The runtime is now picked automatically per GPU type.",
        },
        {
          k: "Ops",
          v: "Cut peak memory of the document service by about 47% (2,257MB → 1,204MB). Added dev, staging, prod promotion and per-MR preview servers across 11 repositories.",
        },
      ],
      evidence:
        "Evidence · deployment repo commits 962/1,069 (90%), model serving repo commits 189/218 (86%), counted 2026.09 · screens and diagrams in the PDF",
      posts: [
        {
          label: "ApplicationSet trial and per-server deployment (KO)",
          href: P.applicationset,
        },
        { label: "Running llama.cpp on ROCm GPUs (KO)", href: P.rocm },
        { label: "Multi-node GPU serving (KO)", href: P.multinode },
      ],
      stack: [
        "FastAPI",
        "K3s",
        "Helm",
        "ArgoCD",
        "vLLM",
        "llama.cpp",
        "PostgreSQL",
        "Valkey",
        "Qdrant",
        "MinIO",
        "Grafana",
      ],
    },
    cards: [
      {
        title: "Generative AI platform for a regional bank",
        wide: true,
        metric: { value: "500 users", label: "on-site, 5 training sessions" },
        badges: [
          "Permission model",
          "Audit logs",
          "Admin IP allowlist",
          "SSO",
          "Write-SQL blocking",
          "Oracle",
        ],
        period: "FDE (forward deployed engineer)",
        ownership: "Agent development · customer communication · training",
        summary:
          "Went on site at a regional bank to build agents, handle customer communication, and train users.",
        points: [
          {
            v: "Agent router, failure log view, SQL query results merged into answers",
          },
          {
            v: "Deployment and model serving on customer servers (GPU memory aware loading, auto recovery)",
          },
        ],
        posts: [],
      },
      {
        title: "Agent harness tuning and evaluation",
        metric: {
          value: "8.21 → 4.5",
          label: "LLM calls per task, eval score held",
        },
        figure: {
          src: "/portfolio/fig-harness.jpg",
          width: 770,
          height: 980,
          alt: "Chart of AI calls per task and eval scores",
          caption: "AI calls per task, 70-task average · PDF p.22 (Korean)",
        },
        period: "2026.08 to present",
        ownership: "Tuning and evaluation (pipeline designed by a teammate)",
        summary:
          "The harness is the layer outside the model that controls tool calls, permissions, and completion checks. The work started from about 8% of real requests stalling midway.",
        points: [
          {
            v: "Integrated Qihoo360's public Harness-Bench, split its 70 tasks into 39 tuning and 31 held-out, and kept only changes that improved both",
          },
          {
            v: "LLM calls per task 8.21 → about 4.5 on average (dev environment, eval score within the range of 4 repeated runs), 0 false completions in 60 checks, base prompt 37% shorter",
          },
          {
            v: "Dropped prompt instructions (followed in 1 of 38 tasks) and adopted only 5 structural changes. Drafted the fast path with AI coding tools (Claude Code, Codex), then ported, verified, and shipped it myself",
          },
          {
            v: "Audited 20,000 run logs and masked 34 exposed passwords and tokens",
          },
        ],
        evidenceLink: {
          label: "Benchmark source · github.com/Qihoo360/harness-bench",
          href: "https://github.com/Qihoo360/harness-bench",
        },
        posts: [
          { label: "Detecting stalled conversations (KO)", href: P.stall },
        ],
      },
      {
        title: "graph-tool-call",
        metric: { value: "9,094", label: "PyPI downloads in 6 months" },
        figure: {
          src: "/portfolio/fig-toolsearch.jpg",
          width: 1400,
          height: 795,
          alt: "Bar charts: prerequisite tool recall 14.3% to 100%, tokens sent 1,476 to 160",
          caption:
            "Prerequisite tool recall and tokens sent · PDF p.16 (Korean)",
        },
        period: "2026.03 to present · open source",
        ownership: "Sole designer and developer (96% of commits)",
        summary:
          "Semantic search found the target tool (refund) but missed the tool that produces its input (order lookup). This library builds an input/output graph between tools to retrieve both.",
        points: [
          {
            v: "Prerequisite tools found in 7 of 7 reproduction cases (was 1 of 7), tokens sent to the model 1,476 → 160",
          },
          {
            v: "Published the negative result that mixing graph scores did not help on 1,068 tools, and changed the design",
          },
          {
            v: "57 PyPI releases, 9,094 downloads in the last 6 months, featured on GeekNews",
          },
        ],
        posts: [
          { label: "Graph-based tool retrieval (KO)", href: P.gtc },
          { label: "1,068-tool stress test (KO)", href: P.gtcBench },
        ],
      },
      {
        title: "LLM fine-tuning",
        metric: {
          value: "14B",
          label: "Korean LLM POLAR, SFT and DPO (12,300 pairs)",
        },
        period: "2024.04 to 06 · 2026.09 to present",
        ownership: "POLAR co-developed at AI Lab, sev is personal",
        summary:
          "Right after joining Plateer I co-built the Korean LLM POLAR at AI Lab, and I am now training small decision models with LoRA.",
        points: [
          {
            v: "POLAR: 14B Korean LLM on SOLAR-10.7B, SFT and DPO (12,300 preference pairs) with DeepSpeed, published on Hugging Face and submitted to the leaderboard",
          },
          {
            v: "sev (2026.09 to present): one harness for data, LoRA training, serving, and evaluation of an Eikos-based Qwen3.5-4B decision model",
          },
        ],
        evidenceLink: {
          label: "Hugging Face · x2bee/POLAR-14B-DPO-v1.3",
          href: "https://huggingface.co/x2bee/POLAR-14B-DPO-v1.3",
        },
        posts: [
          { label: "GliNER and DPO-LoRA fine-tuning (KO)", href: P.gliner },
        ],
      },
      {
        title: "Commerce product search",
        metric: {
          value: "10ms / 74ms",
          label:
            "search server / upstream API, the bottleneck was outside search",
        },
        figure: {
          src: "/portfolio/fig-latency.jpg",
          width: 1400,
          height: 269,
          alt: "Bar chart of latency per hop",
          caption: "Latency per hop · PDF p.25 (Korean)",
        },
        period: "2024.07 to 2026.04 · alongside XGEN from 2025.06",
        ownership: "Hybrid query design · indexing in the Rust rewrite",
        summary:
          'For sentence-like queries such as "red women\'s long coat", I designed one OpenSearch query combining keyword, product vector, and color vector (NestJS, 323 commits).',
        points: [
          {
            v: "Rewrote indexing as 50,000-document streaming batches in the Rust search API and removed about 8,000 lines of batch code",
          },
          {
            v: "Measured each hop after an external load test called it slow: search server 10ms on average, the upstream API about 74ms",
          },
        ],
        posts: [
          { label: "Hybrid search strategy (KO)", href: P.hybrid },
          { label: "Indexing: streaming vs batch (KO)", href: P.indexing },
          {
            label: "AI search for an education retailer (KO)",
            href: P.aiSearchCase,
          },
        ],
      },
    ],
  },
  experience: {
    title: "Experience",
    items: [
      {
        company: "Plateer",
        role: "Part Leader, AI R&D Team (Assistant Manager grade)",
        period: "2024.03 to present",
        bullets: [
          "Joined for commerce search, took on XGEN from 2025.06, Tech & Consulting part leader after the 2026.06 reorg",
          "Co-fine-tuned the Korean LLM POLAR (SFT, DPO) in 2024; built XGEN LangChain nodes in 2025 and a LangGraph chatbot in 2026",
          "Designed and built the XGEN deployment platform and model serving, gateway (Rust) auth and routing, TTA GS test environment",
          "Three-stage promotion, per-MR preview servers, and AI code review across 11 repositories",
          "Demos, PoCs, and consulting for about 30 customers (5 contracts), co-ran an Intel Gaudi2/3 LLM inference PoC",
          "Work allocation, code review, and AI engineer hiring interviews for an 8-person part",
        ],
      },
      {
        company: "Seoul IR Network",
        role: "Manager, Platform Business",
        period: "2023.02 to 2024.02",
        bullets: [
          "Rebuilt and ran IRUP, an IR dashboard SaaS for 12 client companies: news, YouTube, and analyst report clipping, duplicate grouping, alerts, stock-linked dashboards",
          "Built the internal e-approval system alone (Next.js, Node.js, Firebase)",
        ],
      },
      {
        company: "HJ Brain",
        role: "Data Engineer (Intern)",
        period: "2021.07 to 2022.12",
        bullets: [
          "Built and ran crawlers for news, analyst reports, and disclosures, with dedup and a collection monitoring dashboard",
        ],
      },
    ],
  },
  oss: {
    title: "Open source and writing",
    items: [
      {
        name: "graph-tool-call",
        href: "https://github.com/SonAIengine/graph-tool-call",
        desc: "Tool retrieval for LLM agents. Finds the needed tool with its prerequisite tools, and runs as an MCP server or a proxy in front of many MCP servers.",
        badge: "pip install graph-tool-call",
      },
      {
        name: "synaptic-memory",
        href: "https://github.com/PlateerLab/synaptic-memory",
        desc: "Knowledge graph memory for agents. RAG-ko MRR 0.947.",
        badge: "pip install synaptic-memory",
      },
      {
        name: "ku-portal-mcp",
        href: "https://github.com/SonAIengine/ku-portal-mcp",
        desc: "MCP server for the Korea University portal, designed by me and published on PyPI. 2 external PRs.",
        badge: "pip install ku-portal-mcp",
      },
    ],
    writingTitle: "Recent posts (Korean)",
    writingDesc: n =>
      `${Math.floor(n / 10) * 10}+ posts on my tech blog, covering what I built and what failed.`,
    allPosts: { label: "All posts", href: "/posts/" },
  },
  skills: {
    title: "Skills",
    rows: [
      {
        label: "AI · LLM",
        items: ["vLLM", "llama.cpp", "MCP", "RAG", "Qdrant", "OpenSearch"],
      },
      {
        label: "Infra",
        items: [
          "Kubernetes (K3s)",
          "Helm",
          "ArgoCD",
          "Docker",
          "Jenkins",
          "Grafana",
        ],
      },
      { label: "Language", items: ["Python", "Rust", "TypeScript"] },
      {
        label: "Agent",
        items: ["LangChain", "LangGraph", "MCP", "Tool calling"],
      },
      { label: "Training", items: ["DeepSpeed", "TRL (SFT · DPO)", "LoRA"] },
      { label: "AI Coding", items: ["Claude Code", "Codex"] },
      { label: "Framework", items: ["FastAPI", "Axum", "NestJS", "Next.js"] },
      { label: "Data", items: ["PostgreSQL", "Valkey · Redis", "MinIO"] },
    ],
  },
  edu: {
    title: "Education and certificates",
    schools: [
      {
        period: "2026.03 ~",
        school: "Korea University, Graduate School of SW·AI Convergence",
        degree: "M.S. student, AI Convergence",
      },
      {
        period: "2021.02 ~ 2023.02",
        school: "Hanyang University",
        degree: "B.S. Urban Planning (transfer)",
      },
      {
        period: "2019.08",
        school: "Academic Credit Bank System",
        degree: "B.S. Computer Engineering",
      },
    ],
    certsLabel: "Certs",
    certs: [
      "Industrial Engineer Information Processing (2018.11)",
      "Network Administrator Level 2 (2019.04)",
      "SQLD (2023.04)",
      "ADsP (2023.06)",
    ],
  },
  cta: {
    title: "Let's talk",
    body: [
      "Role offers, coffee chats, and technical questions are all welcome.",
      "Especially if your team works on LLM serving, deployment, or agent reliability.",
    ],
    mail: "Email sonsj97@gmail.com",
    pdf: "Portfolio PDF",
  },
};
