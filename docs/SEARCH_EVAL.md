# Search Evaluation

검색 품질을 감으로 보지 않기 위한 작은 문제지/채점기다. `search-service/eval-cases.json`에 질의와 정답 URL을 넣고, `scripts/evaluate-search.mjs`가 실제 검색 API를 호출해 리포트를 만든다.

## 실행

```bash
pnpm run search:eval
```

기본 대상은 `https://search.infoedu.co.kr`이다. 로컬 API를 직접 때릴 때는:

```bash
SEARCH_API=http://127.0.0.1:8182 pnpm run search:eval
```

엄격 모드에서는 실패 케이스가 있으면 exit code 1로 끝난다.

```bash
SEARCH_EVAL_STRICT=true pnpm run search:eval
```

## 산출물

- `reports/search-eval.md`: 사람이 읽는 리포트
- `reports/search-eval.json`: 전후 비교나 대시보드용 원본 결과

`reports/`는 생성 산출물이므로 git에는 올리지 않는다.

## 채점 기준

- `top1`: 첫 결과가 정답 URL인가
- `recall@5`: 상위 5개 안에 정답 URL이 하나라도 있는가
- `MRR@5`: 첫 정답의 역순위 평균
- `sorted`: 결과 점수가 내림차순인가
- `negative`: 무관 질의에서 결과를 과신하지 않는가
- `latency`: API가 기본 800ms 안에 응답하는가

## 현재 관찰된 개선 포인트

2026-06-21 기준 1차 고도화에서 아래 항목은 `search-service/app.py` 후처리 레이어로 반영했다.

- 문서 단위 dedupe 이후 최종 점수 기준으로 다시 정렬한다.
- `Deeplearn`, `graph tool call`, `argo cd`, `v llm`, `llm ops` 같은 작은 alias/오타 정규화를 적용한다.
- raw semantic score만 믿지 않고 title/tag/body의 lexical evidence를 함께 본다.
- lexical evidence가 없는 고점 결과는 top score와 margin이 모두 충분할 때만 살린다.
- `D2`처럼 짧은 토큰 하나만 본문 어딘가에 맞은 경우는 강한 근거로 보지 않는다.
- 검색 응답에 `normalizedQuery`, `confidence`, `sources`, `doc_rank`, `confidence_gate` stage를 노출한다.
- `/search?q=...` 초기 진입 시 Pagefind 입력값 주입 타이밍 때문에 시맨틱 추천이 호출되지 않던 문제를 수정했다.
- `Deep learning`처럼 영문 구가 `Learning to Rank` 같은 단일 단어 글로 끌려가지 않도록 query term을 보정했다.
- 동점에 가까운 결과는 제목/태그 근거 비율을 tie-breaker로 써서 짧은 제품형 질의의 제목 일치도를 우선한다.
- `/search` 화면의 Pagefind 결과는 시맨틱 API가 정상 응답한 경우 confidence gate 결과와 URL이 맞는 항목만 보조 결과로 노출한다.
- 시맨틱 API가 0건을 반환하면 Pagefind의 약한 키워드 매칭 결과도 숨기고, API 장애 때만 Pagefind fallback을 그대로 둔다.

1차 반영 후 운영 API 기준 strict 평가:

```text
cases: 14
pass: 14
positive top1: 100%
positive recall@5: 100%
negative pass: 100%
sorted score pass: 100%
avg latency: 약 312ms
```

## 다음 TODO

- Pagefind, semantic API, graph 검색을 같은 eval runner에서 비교한다.
- 검색 실패를 사람이 검토한 뒤 `eval-cases.json`으로 승격하는 backlog를 만든다.
- alias dictionary를 코드 상수에서 별도 JSON/YAML로 분리한다.
- 검색 API `/health`에 index source commit/hash, indexed document count, ready 상태를 포함한다.
- search service 재시작 중 502가 나오지 않도록 readiness 또는 무중단 재색인을 고려한다.
- graph 검색은 서버가 살아 있을 때 confidence gate가 적용된 서버 결과를 우선하고, 서버 장애 시에만 local Orama fallback을 유지한다.
