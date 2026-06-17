# SON BLOG

AI Engineer 손성준의 기술 블로그 겸 포트폴리오 사이트입니다.

주요 주제는 LLM Serving, AI Search, RAG, MCP Agent, Rust 검색 엔진, Kubernetes/DevOps 운영입니다. AstroPaper v6를 기반으로 하되 한국어 콘텐츠, Knowledge Graph, Pagefind 검색, Mermaid 다이어그램, Decap CMS, 검색 인덱스 산출물을 블로그 운영 방식에 맞게 확장했습니다.

## Tech Stack

- Astro 6
- TypeScript
- Tailwind CSS 4
- MDX / Markdown content collections
- Pagefind static search
- Mermaid
- Cosmograph knowledge graph
- Satori / Sharp OG image pipeline

## Content

글은 `src/content/posts` 아래에 카테고리/서브카테고리 구조로 저장합니다.
글 작성 자동화, 참조 리소스 수집, 초안 작성, 다이어그램/스크린샷 기준은 `docs/WRITING_WORKFLOW.md`에 정리되어 있습니다.

```text
src/content/posts/
  ai/
  search-engine/
  devops/
  full-stack/
  portfolio/
```

주요 공개 페이지:

- `/` - 홈
- `/posts/` - 전체 글
- `/search/` - 통합 검색
- `/graph/` - Knowledge Graph
- `/portfolio/` - 한국어 포트폴리오
- `/portfolio-en/` - English portfolio
- `/archives/` - 아카이브
- `/tags/` - 태그

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm dev
pnpm build
pnpm preview
pnpm run lint
pnpm run format:check
pnpm astro check
```

`pnpm build`는 다음 작업을 함께 수행합니다.

- Knowledge Graph community/layout 갱신
- Mermaid 문법 검사
- Astro 정적 빌드
- Pagefind 인덱싱

## Search

기본 검색은 Pagefind 정적 인덱스를 사용합니다. 그래프 페이지는 `search-index.json`을 기반으로 Orama BM25 검색과 서버 시맨틱 검색 fallback을 함께 사용할 수 있습니다.

서버 검색 서비스는 `search-service/app.py`에 있으며, 빌드 산출물 `dist/search-fulltext.json`을 읽어 SynapticGraph 기반 검색 인덱스를 구성합니다.

## CMS

Decap CMS 설정은 `public/admin/config.yml`에 있습니다. GitHub OAuth 프록시는 `cms-auth/server.mjs`를 사용합니다.

## Deployment

GitHub Pages 배포는 `.github/workflows/deploy.yml`에서 수행합니다. Node.js와 pnpm 버전은 재현성을 위해 다음 기준으로 고정합니다.

- Node.js `24.x`
- pnpm `10.29.1`

운영/배포/URL/검색/그래프 관련 유지보수 기준은 `docs/PROJECT_CONTEXT.md`와 `AGENTS.md`에 정리되어 있습니다. 글 작성 작업은 `docs/WRITING_WORKFLOW.md`를 함께 봅니다.

## License

이 저장소의 사이트 구현은 MIT 라이선스 기반 AstroPaper를 커스터마이즈한 것입니다. 블로그 글의 저작권은 별도 명시가 없는 한 작성자에게 있습니다.
