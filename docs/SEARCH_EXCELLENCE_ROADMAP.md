# Search Excellence Roadmap

SON BLOG의 검색은 단순 탐색 기능이 아니라 검색엔진 역량을 보여주는 포트폴리오 표면이다. 목표는 “글을 찾는다”가 아니라 “질의를 이해하고, 근거 있게 랭킹하고, 평가로 품질을 지킨다”를 사용자가 바로 느끼게 만드는 것이다.

## 현재 구조

- UI: `/search/`
- 정적 검색: Pagefind
- 의미/그래프 검색: `https://search.infoedu.co.kr/search`
- backend: FastAPI + `synaptic-memory`
- signals: BM25/FTS, dense vector, graph evidence, Korean morphology, alias normalization, confidence gate
- eval: `search-service/eval-cases.json` + `pnpm run search:eval:strict`
- deployment: `pnpm run search:deploy` blue/green backend

## Product Principles

1. 검색창은 빠르고 조용해야 한다.
2. 결과는 “왜 이게 상위인지”를 최소한의 신호로 보여줘야 한다.
3. 한국어 복합어, 영문 약어, 하이픈/코드 토큰을 모두 같은 시민으로 다룬다.
4. 무관 질의는 과신하지 않는다.
5. 품질 개선은 감이 아니라 eval case와 로그로 승격한다.
6. 검색 UI는 포트폴리오 데모처럼 보이되, 블로그 독해 흐름을 방해하지 않는다.

## Quality Bar

- `search:eval:strict` positive top1: 100%
- positive recall@5: 100%
- negative pass: 100%
- p95 latency: 800ms 이하
- deploy startup: graph cache hit + warmup 포함 1-2초대
- raw query telemetry 금지: hash, length, result count, latency만 기록

## Roadmap

### 1. Visible Ranking Signals

검색 결과 패널에 BM25, Vector, Hybrid, Kiwi, Alias, Lexical, Rank, Gate 같은 신호를 작게 보여준다. 사용자는 문장을 읽지 않아도 검색엔진이 단순 문자열 검색이 아니라는 것을 알 수 있다.

### 2. Explain Mode

일반 사용자에게는 숨기고, 개발/포트폴리오 관점에서는 결과별 랭킹 근거를 펼쳐볼 수 있게 한다.

- matched terms
- title/tag/body ratio
- exact phrase 여부
- sources: lexical/synaptic/equrl
- normalized query
- operator: OR/AND/EQURL

UI는 `/search/` 결과의 `근거` disclosure로 노출한다. API는 기본 응답을 가볍게 유지하고, `GET /search?q=...&explain=true`일 때만 result별 `explain` payload를 내려준다.

### 3. Query Understanding Layer

alias 사전을 수동 보정에서 운영 자산으로 키운다.

- 검색어 별칭
- 오타/띄어쓰기 보정
- 한글-영문 혼합 표현
- 프로젝트명/기술명 canonical mapping
- 실패 eval case에서 alias 후보 자동 추출

### 4. Evaluation Dashboard

`reports/search-eval.json`과 `history.jsonl`을 사람이 보는 문서에서 검색 품질 대시보드로 올린다.

- route: `/search-quality/`
- public data: `public/assets/search/search-quality.json`
- update command: `pnpm run search:quality`

- top1/recall/MRR trend
- p95/max latency trend
- failing query backlog
- stage coverage
- negative overconfidence trend

### 5. Result Snippets And Highlighting

Pagefind excerpt와 semantic result를 통합해, 왜 해당 글이 걸렸는지 짧은 evidence snippet을 보여준다.

- 제목 매칭
- 본문 phrase
- 태그/카테고리 매칭
- graph/evidence source

### 6. Search-Led Portfolio Entry

검색 페이지 자체를 포트폴리오 데모로 만든다.

- 추천 질의는 많이 노출하지 않는다.
- 대신 결과가 나온 뒤 검색 신호를 보여준다.
- `/topics/search-engine/`과 연결해 검색엔진 업무 글로 자연스럽게 이동하게 한다.

## Immediate Backlog

- [x] graph cache로 전체 재임베딩 제거
- [x] startup hot path에서 본문 Kiwi 선분석 제거
- [x] blue/green search backend deploy
- [x] strict eval 19/19 통과
- [x] `/search/`에 hybrid ranking signals 노출
- [x] explain mode API/UI
- [x] eval history dashboard
- [ ] failure case에서 alias 후보 생성
- [ ] semantic result snippet/highlight
- [ ] query operator UI affordance
