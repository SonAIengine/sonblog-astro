# SON BLOG Agent Notes

이 저장소에서 작업하는 자동화 에이전트와 유지보수자는 먼저 이 파일을 확인한다.

- 프로젝트 운영 기준과 배포 절차는 `docs/PROJECT_CONTEXT.md`를 따른다.
- Node.js는 `24.x`, pnpm은 `10.29.1`을 기준으로 맞춘다.
- 배포 전에는 `pnpm run verify`와 `pnpm run build`를 모두 통과시킨다.
- `pnpm run build`는 graph 데이터, Mermaid lint, Astro build, URL audit, Pagefind 인덱싱을 포함한다.
- `src/redirects.generated.json`, `public/assets/graph/graph-data.json`, `dist/`, `.astro/`, `reports/`는 생성 산출물이다.
- 본문 콘텐츠는 `src/content/posts`에 있고, prose-first 파일이므로 포맷터로 무리하게 재작성하지 않는다.
- URL 정책 변경 시 `scripts/build-redirects.mjs`, `scripts/audit-urls.mjs`, `astro.config.ts`의 sitemap filter를 함께 본다.
- 검색/그래프 이벤트는 GoatCounter로 보내며 raw query는 전송하지 않고 hash, query length, result count만 보낸다.
- GitHub Pages 배포는 `main` push 또는 workflow dispatch로 `.github/workflows/deploy.yml`이 수행한다.
