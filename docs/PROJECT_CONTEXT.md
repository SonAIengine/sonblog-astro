# SON BLOG Project Context

## 개요

SON BLOG는 Astro 6 기반 기술 블로그 겸 포트폴리오 사이트다. 주요 콘텐츠 축은 AI, Search Engine, Full Stack, DevOps이며 `https://infoedu.co.kr`로 GitHub Pages에 배포한다.

## 런타임 기준

- Node.js: `24.x`
- pnpm: `10.29.1`
- package manager: `pnpm@10.29.1`
- 배포 대상: GitHub Pages
- canonical origin: `https://infoedu.co.kr`

## 핵심 명령

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build
pnpm dev
pnpm preview
```

`pnpm run verify`는 타입/컨텐츠/스타일 계층의 빠른 사전 검증이다.

```bash
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run audit:content
```

`pnpm run build`는 실제 배포 산출물 기준 검증이다.

```bash
node scripts/add-communities.mjs
node scripts/add-layout.mjs
node scripts/lint-mermaid.mjs
astro build
node scripts/audit-urls.mjs
pagefind --site dist --glob 'posts/**/*.html'
```

## 콘텐츠 구조

글은 `src/content/posts` 아래 카테고리/서브카테고리 구조로 둔다.
글 기획, 작성 리소스 수집, 초안 자동화, 스크린샷, 발행 전 체크리스트는 `docs/WRITING_WORKFLOW.md`를 따른다.

```text
src/content/posts/
  ai/
  search-engine/
  full-stack/
  devops/
  portfolio/
  notes/
```

주요 페이지는 다음과 같다.

- `/` 홈
- `/posts/` 전체 글
- `/topics/` 주제 허브
- `/topics/ai/`
- `/topics/search-engine/`
- `/topics/full-stack/`
- `/topics/devops/`
- `/search/` 통합 검색
- `/graph/` Knowledge Graph
- `/portfolio/`, `/portfolio-en/`
- `/archives/`, `/tags/`

## SEO와 URL 정책

- canonical origin은 `astro.config.ts`와 `scripts/audit-urls.mjs`에서 `https://infoedu.co.kr` 기준으로 맞춘다.
- legacy 카테고리 landing URL은 topic hub로 리다이렉트한다.
- `src/redirects.generated.json`은 `scripts/build-redirects.mjs`가 생성한다.
- sitemap에는 redirect page가 들어가면 안 된다.
- URL 정책 변경 후에는 반드시 `pnpm run build` 또는 `pnpm run audit:urls`를 실행한다.

## 검색

- `/search/` 기본 검색은 Pagefind 정적 인덱스를 사용한다.
- semantic search section은 `https://search.infoedu.co.kr/search`를 fallback/보강 결과로 사용한다.
- search telemetry는 GoatCounter 이벤트로 기록한다.
- raw query는 보내지 않고 normalized query hash, query length, result count, latency만 보낸다.

## 방문자/조회수

- 방문자 집계는 GoatCounter `sonblog` 사이트를 사용한다.
- 기본 page visit은 `src/layouts/Layout.astro`에서 `count.js`로 기록한다.
- 글별 조회수와 전체 방문수 UI는 `src/components/ViewCounter.astro`가 공개 `/counter/[PATH].json` 엔드포인트를 읽어서 표시한다.
- GoatCounter가 글별 0회 조회를 `404`와 `{"count":"0"}`로 반환할 수 있으므로, HTTP status보다 응답 JSON의 `count` 값을 우선한다. usable count가 없거나 네트워크/JSON 오류가 나면 카운터 UI는 조용히 숨긴다.
- API token은 클라이언트에 넣지 않는다. 기간별 통계나 인기글 랭킹은 별도 서버/빌드타임 작업으로 처리한다.

## Knowledge Graph

- graph 원본 산출물은 `public/assets/graph/graph-data.json`이다.
- `pnpm run graph` 또는 `pnpm run build`가 community/layout을 갱신한다.
- `/graph/` 페이지는 초기 HTML에 graph JSON을 inline하지 않는다.
- `/graph/`는 idle 시점에 JSON과 graph bundle을 자동 lazy load한다.
- 그래프 초기화 실패 시 로딩 패널을 유지하고 재시도 버튼을 노출한다.
- 우측 패널은 그래프 검색 추천 칩과 노드 선택/검색 결과를 함께 제공한다.
- graph 검색도 raw query 없이 hash 기반 GoatCounter 이벤트만 보낸다.

## UI/UX 구조

- 디자인 원칙과 색상 역할은 `docs/DESIGN.md`를 따른다.
- 공통 글 카드 `src/components/Card.astro`는 `tone`으로 목록 밀도를 나눈다.
- 홈 대표 글은 `tone="featured"`, 최신 글은 `tone="compact"`를 사용한다.
- 토픽 학습 경로는 `tone="learning"`으로 단계 안의 글을 compact row로 표시한다.
- `/search/`는 추천 검색어 칩, Pagefind 결과 라벨, 시맨틱 추천 결과 라벨을 함께 제공한다.
- 포스트 상세 페이지는 데스크톱에서 본문 `h2/h3` 기반 sticky TOC를 자동 생성한다.
- 모바일에서는 390px 폭을 기준으로 horizontal overflow가 없어야 한다.
- 모바일 그래프는 캔버스가 첫 화면을 과점유하지 않도록 viewport 기반 높이 제한을 둔다.
- 글 렌더링/이동 성능과 다이어그램 라이브러리 선택 기준은 `docs/PERFORMANCE_AND_DIAGRAMS.md`를 함께 본다.

## Topic Hub

topic 데이터는 `src/data/topics.ts`에서 관리한다.

- topic slug: `ai`, `search-engine`, `full-stack`, `devops`
- 각 topic은 title, description, 대표 글, learning path를 가진다.
- topic 학습 경로의 post id가 실제 글 slug와 맞는지 빌드로 확인한다.

## 자동 내부 링크

본문 자동 내부 링크는 `src/utils/rehypeAutoInternalLinks.ts`와 `src/data/internalLinks.ts`가 담당한다.

- 코드 블록, pre, heading, 기존 anchor 내부는 건드리지 않는다.
- 문서당 최대 링크 수와 target당 링크 수 제한을 둔다.
- 새 topic hub가 생기면 `src/data/internalLinks.ts` 키워드를 함께 갱신한다.

## 콘텐츠 품질 리포트

```bash
pnpm run audit:content
```

리포트는 `reports/content-quality.md`에 생성되며 git에는 포함하지 않는다. 현재 리포트는 누락/길이/내부 링크/이미지 alt/코드 fence 언어 등을 점검한다.

## 배포 절차

1. `git status --short`로 변경 범위를 확인한다.
2. `pnpm install --frozen-lockfile` 필요 여부를 확인한다.
3. `pnpm run verify`를 실행한다.
4. `pnpm run build`를 실행한다.
5. 주요 페이지를 로컬에서 확인한다.
6. `main`에 commit/push한다.
7. GitHub Actions `Deploy to GitHub Pages` 완료를 확인한다.
8. `https://infoedu.co.kr/`, `/topics/`, `/search/`, `/graph/`를 확인한다.

## 배포 전 확인 URL

로컬 개발 서버:

```text
http://127.0.0.1:4400/
```

프로덕션:

```text
https://infoedu.co.kr/
https://infoedu.co.kr/topics/
https://infoedu.co.kr/search/
https://infoedu.co.kr/graph/
```
