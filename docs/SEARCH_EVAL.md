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

- 문서 단위로 합친 결과를 점수 기준으로 다시 정렬해야 한다.
- 무관 질의에 높은 점수를 주는 overconfidence를 줄여야 한다.
- `딥러닝`, `deep learning`, `Deeplearn` 같은 동의어/오타 정규화가 필요하다.
- rerank 적용 여부가 응답 stage와 점수에서 관측 가능해야 한다.
- 검색 서비스 재시작 중 502가 나오지 않도록 readiness 또는 무중단 재색인을 고려한다.
