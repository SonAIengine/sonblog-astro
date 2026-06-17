# sontrader Series Plan

이 문서는 `sontrader` 자동매매 리서치 시리즈를 블로그 글로 풀어낼 때 참고하는 작성 계획이다. 원천 자료는 private `SonAIengine/sontrader` 프로젝트 문서와 로컬 클론의 `docs/plan` 문서들이다. 이 문서는 공개 블로그 저장소에 있으므로 민감한 전략 수치, 계좌, 종목, 주문 세부값, 내부 주소, credential은 기록하지 않는다.

## 시리즈의 관점

`sontrader`의 최종 목표는 자동매매다. 다만 시리즈의 관점은 "자동매매 봇을 먼저 만든다"가 아니라 "자동매매에 맡겨도 되는 신호를 먼저 증명한다"이다.

핵심 메시지는 세 가지다.

- 자동매매는 최종 목표지만, 주문 자동화보다 검증 자동화가 먼저다.
- 좋은 백테스트보다 기각 가능한 절차가 중요하다.
- `order_allowed=false`는 실패가 아니라 기본 안전 상태다.

## 핵심 원천 문서

아래 문서를 먼저 읽고 글을 만든다. 원문 문장을 길게 복사하지 말고, 공개 가능한 구조와 판단만 블로그 문장으로 다시 쓴다.

| 원천 문서                                         | 글감으로 쓰는 부분                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `docs/plan/PLAN_v3_REVIEW.md`                     | "봇 → alpha 탐색 머신 + 운용 보조"로 방향을 바꾼 이유                    |
| `docs/plan/ALPHA_RESEARCH_PROTOCOL.md`            | KB 근거, 데이터 충분성, 사전등록, PIT, OOS, DSR/PBO 게이트               |
| `docs/plan/ALGORITHM_MATURITY_GATE.md`            | 새 알고리즘 후보를 구현하기 전 maturity/evidence card로 막는 구조        |
| `docs/COMPLIANCE.md`                              | 본인 자금 only, 외부 공개 제한, 관계회사 차단, 데이터/뉴스/크롤링 경계   |
| `docs/STATUS.md`                                  | 전체 연구 현황, no-order 상태, 현재 금지된 것과 가능한 것                |
| `docs/plan/M8_KIS_PAPER_LOGGING_PROTOCOL.md`      | KIS paper 실행을 성과 검증이 아니라 로깅/체결 관찰로 다루는 기준         |
| `docs/plan/M62_NO_ORDER_OBSERVATION_DASHBOARD.md` | 주문 없는 observation ledger와 dashboard 구조                            |
| `docs/plan/M65_NO_ORDER_CANDIDATE_REGISTRY.md`    | 여러 후보 family를 통합 registry로 묶되 주문 승인으로 연결하지 않는 구조 |
| `docs/plan/M76_DAILY_OPS_MARKDOWN_REPORT.md`      | daily ops report를 운영 습관으로 만드는 방식                             |
| `docs/plan/M89_CORE_SATELLITE_OPERATING_MODEL.md` | core policy, defensive descriptor, satellite alpha를 섞지 않는 운영 모델 |

## 공개 금지 기준

블로그 본문에 넣지 않는다.

- 실제 계좌, 앱 키, API token, broker credential
- 내부 URL, 서버 주소, 로컬 운영 경로, 배포 주소
- 종목 코드, 종목 선정 기준, 주문 수량 산식
- 전략 threshold, rank/filter rule, 구체적 portfolio construction
- 실측 PnL, 포지션, 운용 금액, 성과 수치
- 원천 데이터 cache명이나 민감한 파일명

필요한 경우 아래처럼 바꿔 쓴다.

| 원문 성격           | 블로그 표현                                        |
| ------------------- | -------------------------------------------------- |
| 특정 종목/계좌/수량 | "실제 주문 세부값은 공개하지 않는다"               |
| 구체 성과 수치      | "운용 게이트를 통과하지 못했다"                    |
| 전략 threshold      | "사전등록한 기준"                                  |
| 내부 파일/endpoint  | "운영 산출물" 또는 "내부 실행 계층"                |
| raw experiment id   | 공개해도 되는 M-number만 사용하고 민감 수치는 제거 |

## 글 목록

### 1. 자동매매로 가는 순서: 주문보다 신호 증명이 먼저다

- 상태: 작성 완료, published
- 파일: `src/content/posts/full-stack/poc/sontrader-autotrading-signal-validation-before-orders.md`
- 원천: `PLAN_v3_REVIEW.md`, `ALPHA_RESEARCH_PROTOCOL.md`, `STATUS.md`
- 초점: 자동매매 최종 목표는 유지하되, 좋은 백테스트 곡선을 바로 주문으로 연결하지 않기 위해 신호 연구와 운용 게이트를 먼저 자동화하게 된 흐름
- 피할 것: 구체 실험 성과, 종목, 실제 계좌, 전략 조건

### 2. scout, preregister, evaluate로 실험을 통제하기

- 상태: 작성 완료, draft
- 파일: `src/content/posts/full-stack/poc/sontrader-research-loop-scout-preregister-evaluate.md`
- 원천: `ALPHA_RESEARCH_PROTOCOL.md`, 여러 `M*_PREREGISTRATION.md`, `M*_DIAGNOSTIC.md`
- 초점: 아이디어를 바로 전략으로 쓰지 않고, 후보 수집 → 조건 고정 → 고정 기준 평가 → 실패 기록으로 돌리는 루프
- 피할 것: 실제 metric 값, threshold, 종목별 결과

### 3. PIT와 생존편향: 백테스트가 미래를 훔치지 못하게 하기

- 상태: 예정
- 원천: `ALPHA_RESEARCH_PROTOCOL.md`, `BACKTEST_ENGINE_HARDENING.md`, `DATA_SUFFICIENCY_REVIEW.md`
- 초점: effective time과 knowledge time을 분리해야 하는 이유, 상폐/정정/공시 인지 시점이 백테스트를 어떻게 오염시키는지
- 다이어그램: event time과 knowledge time timeline

### 4. Algorithm Maturity Gate: 코드를 쓰기 전에 막는 장치

- 상태: 예정
- 원천: `ALGORITHM_MATURITY_GATE.md`, evidence card 계열 문서
- 초점: "일단 돌려보자"를 막고, 경제적 메커니즘과 데이터 계획이 없는 후보는 구현하지 않는 구조
- 피할 것: 실제 scoring 값과 특정 후보의 민감한 판정 수치

### 5. no-order watchlist와 observation ledger

- 상태: 예정
- 원천: `M62_NO_ORDER_OBSERVATION_DASHBOARD.md`, `M63_OPERABLE_CANDIDATE_PREREG_GATE.md`, `M65_NO_ORDER_CANDIDATE_REGISTRY.md`
- 초점: 좋아 보이는 후보를 바로 주문하지 않고 관찰 ledger로 보내는 설계
- 핵심 문장: "대부분의 후보는 주문 후보가 아니라 관찰 후보여야 한다."

### 6. synaptic-memory를 자동매매에서 어디에 둘 것인가

- 상태: 예정
- 원천: `PLAN_v3_REVIEW.md`, `STATUS.md`, 온톨로지/graph 관련 M52~M60, M149~M156 계열 문서
- 초점: synaptic-memory를 예측기처럼 쓰지 않고 연구 기억, 실패 회고, 가설 중복 방지, 설명/위험관리 계층으로 쓰는 방식
- 피할 것: graph feature가 직접 alpha를 냈다는 식의 과장

### 7. KIS paper 실행은 성과 검증이 아니라 실행 관찰이다

- 상태: 예정
- 원천: `M8_KIS_PAPER_LOGGING_PROTOCOL.md`, `docs/runbook/kis-paper-smoke.md`, `docs/runbook/kis-heartbeat.md`
- 초점: paper 실행을 "돈 벌기 예행연습"이 아니라 주문/체결/로그/heartbeat 관찰로 다루는 이유
- 피할 것: 실제 계좌, 주문값, API 세부 endpoint

### 8. Daily Ops: 자동매매 리서치를 매일 닫는 방법

- 상태: 예정
- 원천: `M76_DAILY_OPS_MARKDOWN_REPORT.md`, `M77_DAILY_OPS_KEY_METRICS.md`, `M78_DAILY_OPS_CANDIDATE_READINESS.md`, `M79_DAILY_OPS_DISTANCE_TO_READY.md`, `M80_DAILY_OPS_CANDIDATE_AGING.md`
- 초점: 매일 무엇을 확인하고, 어떤 상태를 WARN/WAIT/BLOCKED로 남기는지
- 다이어그램: daily check → report → next action

### 9. core, defensive descriptor, satellite alpha를 섞지 않기

- 상태: 예정
- 원천: `M89_CORE_SATELLITE_OPERATING_MODEL.md`, low-vol/dashboard 계열 문서
- 초점: core policy는 운용 설계, low-vol는 방어 설명자, satellite alpha는 별도 승격 후보로 분리하는 이유
- 피할 것: 실제 ETF/종목/비중/금액

### 10. 왜 아직 `order_allowed=false`인가

- 상태: 예정
- 원천: `STATUS.md`, `ALPHA_RESEARCH_PROTOCOL.md`, no-order 계열 문서
- 초점: 자동매매 프로젝트에서 "아직 주문하지 않는다"가 가장 중요한 결론일 수 있다는 회고
- 위치: 시리즈 마무리 글

## 작성 톤

보안 때문에 딱딱한 문서처럼 쓰기 쉽다. 하지만 블로그 글은 먼저 경험의 흐름이 보여야 한다.

권장 톤:

- "처음엔 이렇게 생각했다. 그런데 해보니 이게 더 위험했다."
- "이 결정은 답답하지만, 나중의 나를 보호한다."
- "자동매매를 안 하겠다는 게 아니라, 너무 일찍 하지 않겠다는 것이다."

피할 톤:

- "본 글은 ... 다룬다"로 시작하는 보고서체
- 공개 금지 목록을 첫 화면 대부분으로 쓰는 방식
- 모든 문장을 원칙/정의/표로만 설명하는 방식
- 성과를 암시하는 문장

## 발행 전 체크

1. `draft: true` 상태로 먼저 작성한다.
2. `rg`로 token, 계좌, 내부 URL, 종목 코드, 성과 수치 노출을 확인한다.
3. `pnpm run audit:content`를 실행한다.
4. 다이어그램이 있으면 `pnpm run lint:mermaid` 또는 `pnpm run lint:d2`를 실행한다.
5. 공개해도 되는지 마지막으로 원천 문서와 대조한다.
6. 발행할 때만 `draft: false`로 전환하고 `pnpm run verify`, `pnpm run build`를 실행한다.
