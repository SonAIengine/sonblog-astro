---
title: 'graph-tool-call v0.15: 1068 Tool 스트레스 테스트와 워크플로우 체인 엔진'
description: graph-tool-call을 v0.7에서 v0.15까지 진화시키며 겪은 기술적 의사결정을 정리한다. 6개 retrieval
  전략 경쟁 벤치마크로 Graph의 실제 가치를 검증하고, BM25보다 나쁜 결과를 내던 Graph를 candidate injection 아키텍처로
  전환한 과정, 그리고 LLM Agent의 왕복 호출을 줄이는 워크플로우 체인 API를 구현한 경험을 다룬다.
pubDatetime: 2026-03-22
tags:
- LLM Agent
- Tool Retrieval
- 그래프 검색
- BM25
- wRRF
- 벤치마크
- MCP
- Python
- graph-tool-call
- Workflow
- AI
---


# graph-tool-call v0.15: 1068 Tool 스트레스 테스트와 워크플로우 체인 엔진

## 이전 글에서

[이전 글](graph-tool-call-llm-agent-graph-based-tool-search-engine.md)에서 graph-tool-call의 기본 아키텍처를 다뤘다. OpenAPI 스펙에서 tool을 수집하고, BM25 + 그래프 확장 + 임베딩을 결합한 하이브리드 검색으로 LLM에 필요한 tool만 전달하는 구조였다. Kubernetes 248 tools에서 baseline 12% → 78% 정확도를 달성했다.

그 이후 v0.15까지 올리면서 핵심적인 질문 세 가지를 마주했다.

1. **Graph가 정말 vector search보다 나은가?** 자체 벤치마크가 아닌 공정한 비교가 필요했다.
2. **1000개 이상의 tool에서도 동작하는가?** 248에서 멈추면 "작은 규모에서만 된다"는 의심을 해소할 수 없다.
3. **Graph만이 할 수 있는 것이 있는가?** Recall 몇 % 올리기가 아닌, 구조적으로 차별화된 가치가 필요했다.

이 글은 세 질문에 답하면서 내린 기술적 판단과 그 결과를 다룬다.


## 경쟁 벤치마크: Graph vs Vector 공정 비교

### 왜 공정 비교가 필요했나

v0.7까지의 벤치마크는 모두 자체 데이터셋에서 자체 파이프라인끼리 비교한 것이었다. "BM25+Graph가 baseline보다 좋다"는 보여줬지만, "vector search만 쓰는 bigtool 같은 경쟁자보다 좋은가?"에는 답하지 못했다.

bigtool (LangGraph의 도구 검색 라이브러리)의 소스코드를 분석했다. 핵심은 단순했다. LangGraph Store의 `store.search()` — 내부적으로 벡터 유사도 검색이다. bigtool 자체는 retrieval 알고리즘이 아니라 LangGraph Store 위에 얹은 wrapper였다.

따라서 공정 비교 전략을 이렇게 잡았다:

| 전략 | 설명 |
|------|------|
| **Vector Only** | qwen3-embedding 코사인 유사도만 (bigtool과 동등) |
| **BM25 Only** | 키워드 매칭만 |
| **Graph Only** | 그래프 확장만 |
| **BM25 + Graph** | 현재 기본값 |
| **Vector + BM25** | 하이브리드 (graph 없이) |
| **Full Pipeline** | BM25 + Graph + Embedding |

9개 데이터셋 (19~1068 tools), 동일 쿼리 세트, 동일 평가 메트릭으로 비교했다.

### 결과: 불편한 진실

```
Overall Average (9개 데이터셋)

| 전략                  | Recall@5 | MRR   | Latency |
|-----------------------|----------|-------|---------|
| Vector Only (≈bigtool)| 96.8%   | 0.897 | 176ms   |
| BM25 Only             | 91.6%   | 0.819 | 1.5ms   |
| BM25 + Graph          | 91.6%   | 0.819 | 14ms    |
| Full Pipeline         | 96.8%   | 0.897 | 172ms   |
```

**embedding이 지배적이었다.** Vector Only가 이미 96.8% Recall, 0.897 MRR을 달성했고, Graph/BM25를 아무리 붙여도 embedding 위에 추가 이득이 없었다.

더 심각한 것은 **BM25+Graph가 BM25 Only보다 같거나 나빴다**는 점이다. Graph가 BM25 결과를 해치고 있었다.

### Graph가 BM25를 해치던 원인

원인 분석에 시간이 걸렸다. 세 가지 버그/설계 결함이 있었다.

**1. `set_weights()` 버그**

```python
def _get_adaptive_weights(self):
    # set_weights()로 설정한 값을 완전히 무시하고
    # 하드코딩된 값을 반환하고 있었다
    n = len(self._tools)
    if n <= 30:
        return (0.55, 0.30, 0.0, 0.15)  # ← 항상 이 값
```

`set_weights(keyword=1.0, graph=0.0)`으로 설정해도 `_get_adaptive_weights()`가 하드코딩된 값을 돌려보냈다. weight가 실제로 적용되지 않으니 모든 전략이 동일한 결과를 냈다. 이 버그를 발견하기까지 벤치마크를 5번 돌렸다.

**2. Graph가 BFS seed를 BM25에서 가져감**

기존 Graph의 동작 방식은:

```
쿼리 → BM25 top-10 뽑음 → 그 10개의 이웃을 찾음 → 끝
```

BM25가 이미 찾은 것의 이웃만 보니까 BM25와 같은 결과를 낼 수밖에 없었다. Graph가 독립적인 retrieval 신호를 제공하지 못하고 BM25의 노이즈만 증폭하고 있었다.

**3. annotation이 대규모 corpus에서 오염 유발**

248 tools 이상에서는 annotation weight가 정확한 BM25 결과를 밀어냈다. "Create a new Kubernetes service" 쿼리에서 BM25가 `createCoreV1NamespacedService`를 정확히 찾았지만, annotation의 "create intent" 점수가 모든 create* tool을 끌어올려서 `createCoreV1Namespace`(다른 tool)가 상위에 올라왔다.


## 아키텍처 전환: Graph를 wRRF에서 분리

### 결정: Graph는 scoring 채널이 아니다

분석 결과, Graph를 wRRF의 4번째 scoring 채널로 넣는 게 근본 문제였다. Graph의 정확도가 BM25보다 낮으니, fusion에서 BM25 결과를 오염시켰다.

Graph의 진짜 가치는 **scoring이 아니라 candidate injection**이다:

```
[Before: wRRF 4채널 fusion]
BM25 + Graph + Embedding + Annotation → wRRF → 결과
         ↑ noise

[After: Graph를 분리]
BM25 + Embedding + Annotation → wRRF → 1차 결과
                                          ↓
Graph → candidate injection → 최종 결과
        (BM25가 못 찾은 tool만 추가)
```

핵심 규칙: **Graph는 절대 BM25 결과를 밀어내지 않는다.** 오직 BM25가 miss한 candidate를 tail에 추가만 한다.

```python
def _inject_graph_candidates(self, final_scores, graph_scores, ...):
    # BM25 결과에 없는 tool만 추출
    new_candidates = {
        name: score for name, score in graph_scores.items()
        if name not in final_scores
    }
    # 최저 BM25 점수보다 낮게 injection
    min_primary = min(final_scores.values())
    injection_base = min_primary * 0.8
    for name, g_score in ranked[:max_inject]:
        final_scores[name] = injection_base * norm_score
```

이 전환 후 **BM25+Graph ≥ BM25 Only**가 보장됐다.


## Resource-first Graph Search: GitHub alias 49개 제거

기존 graph_search.py에는 GitHub API 전용 alias가 49개 하드코딩돼 있었다.

```python
# 이전 코드 — GitHub 전용
_RESOURCE_ALIASES = {
    "pull request": "pulls",
    "pr": "pulls",
    "issue": "issues",
    "repo": "repos",
    "workflow": "actions",
    # ... 49개
}
```

이걸 **동적 역인덱싱**으로 교체했다. OpenAPI를 ingest하면 카테고리 노드 → tool name/description 토큰이 자동으로 인덱싱된다.

```python
# 이후 코드 — 범용
for neighbor in self._graph.get_neighbors(node, direction="in"):
    # tool name: requestRefund → "refund" → orders 카테고리
    name_parts = re.sub(r"([a-z])([A-Z])", r"\1 \2", neighbor)
    for t in name_tokens:
        index[stem(t)] = category_node
    # tool description 키워드도 역인덱싱
    for t in desc_tokens:
        index[stem(t)] = category_node
```

이렇게 하면 어떤 API를 넣어도 "refund" → orders, "checkout" → cart, "stargazer" → activity 같은 매핑이 자동으로 만들어진다.


## 1068 Tool 스트레스 테스트

### GitHub 전체 API

GitHub REST API의 OpenAPI 스펙 전체를 가져왔다. 1068개 endpoint, 50개 쿼리로 테스트했다.

```
| 전략            | Recall@5 | MRR   | Miss% |
|-----------------|----------|-------|-------|
| Vector Only     | 88.0%    | 0.761 | 12.0% |
| BM25 Only       | 78.0%    | 0.643 | 22.0% |
| BM25 + Graph    | 78.0%    | 0.643 | 22.0% |
| Full Pipeline   | 88.0%    | 0.761 | 12.0% |
```

1068 tools에서도 동작은 했지만, miss rate 22%는 높았다. miss 케이스를 분석했다:

- "Close an existing issue" → 기대: issues/update, 결과: 못 찾음. "close" ≠ "update"
- "Add org member" → 기대: orgs/set-membership-for-user. 완전히 다른 이름
- "Register self-hosted runner" → 기대: actions/create-registration-token-for-repo. 간접 매핑

**공통점: 쿼리의 자연어 표현과 tool name이 다를 때 miss.** 이건 BM25의 본질적 한계이고, embedding이 해결해야 할 영역이다. Graph로는 해결 불가능하다는 걸 인정했다.


## Graph의 진짜 가치를 찾다: 워크플로우 체인

### Recall 경쟁을 그만두다

벤치마크를 반복하면서 깨달은 것이 있다. Graph의 가치는 **retrieval 정확도 경쟁이 아니다.** BM25/embedding이 개별 tool 찾기에서는 이미 충분히 좋다. Graph만이 할 수 있는 것은 따로 있었다.

사용자가 "환불 처리해줘"라고 말하면:

- BM25: `requestRefund` 1개 반환
- Embedding: `requestRefund` 1개 반환
- **Graph: `getOrder → requestRefund` 체인 반환** (순서 포함)

LLM Agent가 `requestRefund`만 받으면 `order_id`가 없어서 실패하고, `getOrder`를 호출한 뒤 재시도해야 한다. 3~4번 왕복. Graph가 체인을 주면 1번에 끝난다.

### plan_workflow() API

이 아이디어를 `plan_workflow()` API로 구현했다.

```python
plan = tg.plan_workflow("process a refund")
for step in plan.steps:
    print(f"{step.order}. {step.tool.name} — {step.reason}")
# 1. listOrders — prerequisite for requestRefund
# 2. requestRefund — primary action
```

내부 동작:

1. Resource-first search로 primary tool 찾기 (쿼리 키워드 ↔ tool name 매칭)
2. 해당 tool의 REQUIRES/PRECEDES 관계에서 **같은 카테고리의 GET/LIST**만 prerequisite로 수집
3. Topological sort로 실행 순서 결정

### 체인 폭발 문제와 해결

처음에는 REQUIRES 관계를 BFS로 모두 따라갔다. "cancel an order"를 치면 12개 step이 나왔다. createUser, addToWishlist까지 딸려왔다.

원인은 ontology builder가 관계를 너무 느슨하게 잡기 때문이다. requestRefund가 listOrders, createOrder, addToCart 전부를 REQUIRES로 가리키고 있었다.

해결: **같은 카테고리 + GET/POST만 prerequisite로 허용**

```python
# 체인 필터링 규칙
same_cat = (target_category == neighbor_category)
is_getter = method == "GET" or name.startswith("get") or name.startswith("list")
if same_cat and is_getter:
    # 이것만 prerequisite로 인정
```

이 필터링으로 "cancel an order"가 12 steps → 3 steps로 줄었다.

### 수동 편집과 시각화 편집기

자동 생성이 100% 정확할 수 없다는 걸 전제로 했다. "close an issue"에서 updateIssue를 자동으로 찾지 못하는 건 semantic gap이고, keyword 기반 한계다.

따라서 **편집이 쉬워야 한다**는 걸 설계 원칙으로 잡았다.

코드 편집:

```python
plan = tg.plan_workflow("close an issue")
plan.reorder(["getIssue", "updateIssue"])
plan.set_param_mapping("updateIssue", "issue_id", "getIssue.response.id")
plan.save("close_issue.json")
```

시각화 편집: `plan.open_editor(tools=tg.tools)`를 호출하면 브라우저에서 드래그앤드롭 에디터가 열린다. zero-dependency 단일 HTML 파일이다. step 순서를 드래그로 바꾸고, 사이드바에서 tool을 클릭해서 추가하고, Export JSON으로 저장한다.


## SSE/Streamable-HTTP: 원격 배포

MCP 서버의 stdio 전용 제약도 해결했다. SSE와 Streamable-HTTP transport를 추가해서 원격 배포가 가능해졌다.

```bash
# 서버 1대에 띄우고
graph-tool-call serve --source api.json --transport sse --port 8000

# 팀원들은 URL만 설정
{
  "mcpServers": {
    "tool-search": {
      "url": "http://tool-search.internal:8000/sse"
    }
  }
}
```

stdio는 1:1 로컬 연결이지만, SSE는 1:N 네트워크 연결이다. 개발자 10명이 각자 설치하는 대신 서버 1대를 공유할 수 있다.


## 결과 요약

v0.7에서 v0.15까지의 주요 수치 변화:

| 지표 | v0.7 | v0.15 | 변화 |
|------|------|-------|------|
| 지원 tool 규모 | 248 | **1068** | 4.3x |
| Recall@5 (no embedding) | 91.0% | **91.6%** | +0.6% |
| Graph 아키텍처 | wRRF fusion (해침) | **candidate injection** (안전) |
| 워크플로우 체인 | 없음 | **plan_workflow()** |
| 원격 배포 | 불가 (stdio) | **SSE/HTTP** |
| GitHub alias | 49개 하드코딩 | **자동 역인덱싱** |
| Intent 사전 | 기본 | **+16 동사** |
| 한영 사전 | 35개 | **114개** |

### 배운 것

**Graph의 가치는 retrieval 정확도가 아니다.** embedding이 있으면 vector search가 이기고, embedding이 없으면 BM25만으로 충분하다. Graph를 scoring 채널로 쓰면 오히려 해친다.

**Graph만이 할 수 있는 것은 프로세스 체인이다.** "이 tool을 쓰려면 먼저 뭘 호출해야 하는지"는 BM25도 embedding도 모른다. REQUIRES/PRECEDES 관계를 가진 그래프만 알 수 있다.

**100% 자동화를 포기하면 더 나은 도구가 된다.** 자동 생성 + 쉬운 편집이 자동 생성 + 높은 정확도보다 현실적이다. 시각화 편집기를 만든 게 accuracy 1% 올리는 것보다 사용자에게 더 가치 있었다.


## 다음 단계

- 블로그/커뮤니티 확산 — 이 글이 그 시작이다
- ontology builder의 관계 추론 개선 — REQUIRES가 너무 느슨한 문제
- LLM-assisted workflow planning — Graph가 구조를 제공하고, LLM이 cross-resource gap을 채우는 구조
- production 사례 확보 — 실제 서비스에서의 사용 피드백
