---
title: '시맨틱 검색 API: 요약(Summary) 기능 온/오프 전략'
description: 이커머스 검색 API에서 상품 요약 기능을 GPT, EXAONE 로컬 LLM, FAISS 벡터 검색 세 가지 전략으로 시도하고,
  운영 환경에서 온/오프 제어와 워커 스케일링까지 적용한 과정을 정리한다.
pubDatetime: 2026-02-18
tags:
- Summary
- GPT
- EXAONE
- FAISS
- FastAPI
- uvicorn
- 검색 API
- Search Engine
---


이커머스 검색에서 "겨울에 입기 좋은 따뜻한 코트"라는 문장형 검색어가 들어오면, 이것을 "겨울 코트 보온"이라는 핵심 키워드로 변환해야 OpenSearch가 제대로 검색할 수 있다. 이 키워드 추출을 "상품 요약(Product Summary)"이라고 불렀다. 2024년 10월부터 12월까지, 이 기능을 세 가지 다른 전략으로 구현하고 전환하며 최적의 방식을 찾아간 과정을 정리한다.

## 배경: 문장형 검색어의 문제

OpenSearch는 키워드 기반 검색에 최적화되어 있다. "코트"를 검색하면 상품명에 "코트"가 포함된 결과를 정확히 찾는다. 하지만 "겨울에 입기 좋은 따뜻한 코트"를 그대로 검색하면, "겨울", "입기", "좋은", "따뜻한", "코트" 각 단어가 독립적으로 매칭되면서 관련 없는 결과가 올라올 수 있다.

이 문제를 해결하려면 문장에서 핵심 의미를 추출하는 전처리가 필요하다. search-semantic-api에서 이 역할을 하는 것이 Summary API(`/api/ai/v1/product_summary`)다.

## 세 가지 전략의 시도와 전환

### 전략 1: GPT-4o-mini (OpenAI API)

가장 먼저 도입한 방식이다. 검색어를 GPT-4o-mini에 넘기고 JSON 형태로 핵심 키워드를 받는다.

```
# 커밋: fix: openai 수정
# 날짜: 2024-10-23 13:50
```

```python
# services/text_service.py
def generate_product_summary(decoded_text):
    PROMPT = """
    다음 문장형 검색어에서 제품의 핵심 키워드를 추출하여 반환하세요.
    불필요한 접미사나 수식어는 제거하고 핵심 의미만 남겨서 반환합니다.
    계절성을 의미하는 형용사는 유지합니다. (추울때 더울때 따뜻할때 시원할때 등등)

    **조건:**
    1. "복", "용", "품" 등의 불필요한 접미사는 제거하여 핵심 의미만 반환
    2. 반환 형식은 JSON: {"category_keyword": "", "search_word": "", "recommand_product": ""}
    """
    response = openai.ChatCompletion.create(
        model=OPENAI_MODEL,      # gpt-4o-mini
        messages=[{"role": "system", "content": PROMPT},
                  {"role": "user", "content": decoded_text}],
        max_tokens=MAX_TOKENS,   # 120
        temperature=TEMPERATURE, # 0.1
    )
```

GPT가 반환하는 JSON에서 `category_keyword`(카테고리), `search_word`(검색 키워드), `recommand_product`(추천 상품 키워드)를 추출한다. 예를 들어 "겨울에 입기 좋은 따뜻한 코트"에 대해:

```json
{
  "category_keyword": "아우터",
  "search_word": "겨울 코트 따뜻한",
  "recommand_product": "패딩코트, 울코트, 다운자켓"
}
```

**장점**: 높은 정확도, 문맥 이해력 우수
**단점**: API 호출 비용, 응답 지연(500ms~1s)

### 전략 2: EXAONE 로컬 LLM

```
# 커밋: fix: EXAONE 추가
# 날짜: 2024-11-01 10:07
```

GPT 비용을 줄이기 위해 EXAONE 3.0 7.8B 모델을 로컬에서 실행하는 방식을 시도했다. GGUF 포맷(Q3_K_S 양자화)으로 llama.cpp를 통해 추론한다.

```python
# services/model_service.py - EXAONE 초기화
repo = "bartowski/EXAONE-3.0-7.8B-Instruct-GGUF"
filename = "EXAONE-3.0-7.8B-Instruct-Q3_K_S.gguf"

summary_llm = Llama(
    model_path=model_path,
    n_ctx=128,
    n_gpu_layers=-1,
    device="cuda",
    torch_dtype=torch.float16,
)
```

```python
# services/text_service.py
def generate_product_summary_x(decoded_text):
    prompt = f"""검색어에서 핵심 키워드를 추출하세요.
    입력: {decoded_text}
    출력: [키워드1] [키워드2] ..."""

    response = model_service.summary_llm(
        prompt,
        max_tokens=50,
        stop=["\nUser:", "\nSystem:", "\nAssistant:"],
        temperature=0.0,
    )
    generated_text = response["choices"][0]["text"]
    extracted_words = re.findall(r"\[([^\]]+)\]", generated_text)
    return " ".join(extracted_words)
```

**장점**: API 비용 없음, 네트워크 지연 없음
**단점**: GPU 메모리 점유, 다른 모델과 리소스 경쟁, GPT 대비 낮은 키워드 추출 정확도

같은 날(11/01) GPT와 EXAONE 사이에서 세 번 왕복했다.

```
10:07 — EXAONE으로 전환 (fix: EXAONE 추가)
13:03 — GPT로 롤백 (fix: gpt로 변경)
13:07 — 다시 EXAONE으로 (fix: exaone으로)
```

결국 11월 8일에 GPT로 최종 결정하고, EXAONE 관련 코드는 주석 처리했다.

### 전략 3: FAISS 벡터 검색

```
# 커밋: fix: faiss사용
# 날짜: 2024-11-18 17:28
```

LLM 호출 자체를 없애고, 사전 구축된 FAISS 벡터 인덱스에서 유사 키워드를 찾는 방식이다. 이 전략의 상세 구현은 [FAISS 벡터 인덱스 적용과 GPU 디바이스 최적화](faiss-vector-index-apply-gpu-device-optimization.md) 글에서 다루었다.

```python
def generate_product_summary_faiss(decoded_text):
    score_threshold = 0.3
    final_result = model_service.faiss_search.expand_keywords_with_faiss(
        decoded_text, score_threshold=score_threshold
    )
    return final_result
```

**장점**: 밀리초 단위 응답, 비용 없음
**단점**: 의미적 유사어만 반환, 검색 의도 파악 불가

11월 18일에 도입하여 이틀간 유사도 임계값과 반복 횟수를 튜닝했지만, 11월 20일에 GPT로 복귀했다.

## 온/오프 제어 메커니즘

Summary 기능의 온/오프는 두 가지 레벨에서 제어된다.

### 전략 전환: 라우터에서 함수 교체

```python
# routers/product_summary.py

# GPT 방식 (최종 채택)
summary = generate_product_summary(decoded_text)

# EXAONE 방식 (11/01 시도 → 폐기)
# summary = generate_product_summary_x(decoded_text)

# FAISS 방식 (11/18 시도 → 11/20 폐기)
# summary = generate_product_summary_faiss(decoded_text)
```

어떤 전략을 쓸지는 라우터 파일에서 호출 함수를 교체하는 방식이다. 세 함수 모두 동일한 시그니처(`decoded_text → string`)를 유지하기 때문에 한 줄만 바꾸면 전략이 전환된다.

### API 자체 비활성화: app.py에서 라우터 토글

```
# 커밋: fix: summary off
# 날짜: 2024-11-29 10:38
```

```python
# app.py - Summary API 완전 비활성화
app.include_router(image_detection.router)
app.include_router(vectorization.router)
app.include_router(predict_category.router)
# app.include_router(product_summary.router)  # OFF
app.include_router(get_vectors.router)
```

```
# 커밋: fix: summary on
# 날짜: 2024-11-29 13:26
```

```python
# app.py - Summary API 재활성화
app.include_router(product_summary.router)  # ON
```

같은 날 오전에 비활성화하고 오후에 다시 활성화했다. 이런 패턴이 반복된 것은 Summary API가 NestJS 검색 서비스에서 동기적으로 호출되기 때문이다. Summary API가 느리거나 오류가 나면 전체 검색 응답이 지연된다. 문제가 발생하면 빠르게 라우터를 주석 처리하여 Summary를 우회하고, 문제를 해결한 뒤 다시 활성화하는 운영 패턴이 자연스럽게 만들어졌다.

## MAX_TOKENS 튜닝

```
# 커밋: fix: summary on
# 날짜: 2024-12-12 10:46~11:02
```

GPT 응답 속도를 높이기 위해 MAX_TOKENS를 줄이는 시도를 했다.

| 단계 | MAX_TOKENS | 결과 |
|------|-----------|------|
| 초기 | 128 | 정상 작동, 응답 다소 느림 |
| 1차 시도 | 58 | 응답 잘림, JSON 파싱 실패 |
| 2차 시도 | 120 | 정상 작동, 속도 미미하게 개선 |

58로 줄였더니 GPT가 JSON을 완성하지 못하고 중간에 잘리는 케이스가 발생했다. 특히 `recommand_product` 필드에 여러 상품을 나열하다가 토큰이 부족해지면 `"패딩코트, 울코`에서 끊긴다. 결국 120으로 복원했다. 128에서 120으로 8토큰만 줄인 것이지만, 프롬프트 최적화와 함께 응답 시간이 약간 개선되었다.

같은 날 프롬프트도 간소화를 시도했다가 다시 상세 버전으로 복원했다. 프롬프트를 짧게 만들면 GPT가 조건을 빠뜨리는 경우가 있었다. 특히 "계절성 형용사 유지" 조건이 중요했는데, 이것이 빠지면 "따뜻한 겨울 코트"에서 "따뜻한"이 제거되어 검색 품질이 떨어진다.

## Workers 스케일링

```
# 커밋: fix: summary on, fix: workers
# 날짜: 2024-12-17 08:20~08:41
```

Summary API는 동기적으로 GPT를 호출하므로, 동시 요청이 많아지면 단일 프로세스로는 처리가 안 된다. FastAPI가 비동기지만 GPT 호출은 동기 블로킹이기 때문이다.

```python
# 초기: 단일 워커
uvicorn.run("app:app", host="0.0.0.0", port=5001)

# 1차 개선: 고정 3개 워커
uvicorn.run("app:app", host="0.0.0.0", port=5001, workers=3)

# 최종: CPU 코어 수 기반 동적 설정
import multiprocessing
n_workers = multiprocessing.cpu_count()
uvicorn.run("app:app", host="0.0.0.0", port=5001, workers=n_workers)
```

처음에는 workers=3으로 하드코딩했다가, 서버 환경에 따라 유연하게 대응하기 위해 `multiprocessing.cpu_count()`로 변경했다. 워커를 늘리면 동시에 여러 GPT 호출을 처리할 수 있어 전체 처리량(throughput)이 올라간다.

다만 주의할 점이 있다. GPU 모델(Object Detection, Vision Transformer, Reranker)을 로드하는 서비스에서 workers를 늘리면 각 워커마다 모델이 로드되어 GPU 메모리가 워커 수만큼 필요하다. 이 서비스에서는 GPU 모델이 서버 시작 시 초기화되므로, 워커 수를 과도하게 늘리면 GPU OOM이 발생할 수 있다.

## 전체 타임라인

```mermaid
flowchart LR
    A[10/23 GPT 도입] --> B[11/01 EXAONE 시도]
    B --> C[11/08 GPT 확정]
    C --> D[11/18 FAISS 시도]
    D --> E[11/20 GPT 복귀]
    E --> F[11/29 Summary off/on]
    F --> G[12/12 토큰 튜닝]
    G --> H[12/17 Workers 스케일링]
```

| 날짜 | 커밋 | 내용 |
|------|------|------|
| 10/23 | fix: openai 수정 | GPT-4o-mini 기반 Summary 최초 구현 |
| 10/29 | fix: prompt 수정 | GPT 프롬프트 개선 |
| 11/01 | fix: EXAONE 추가 | EXAONE 7.8B 로컬 LLM 도입, 같은 날 3번 전환 |
| 11/08 | fix: gpt 업그레이드 | GPT 최종 확정, JSON 프롬프트 구조 개편 |
| 11/08 | fix: 계절성 형용사 유지 | 프롬프트에 계절 형용사 보존 조건 추가 |
| 11/18 | fix: faiss사용 | FAISS 벡터 검색 방식 시도 |
| 11/20 | fix: gpt | FAISS 폐기, GPT 복귀 |
| 11/29 | fix: summary off/on | Summary API 비활성화 후 같은 날 재활성화 |
| 12/12 | fix: summary on (4건) | MAX_TOKENS 128→58→120, 프롬프트 간소화 시도/복원 |
| 12/17 | fix: summary on, workers | uvicorn workers 단일→3→cpu_count() |

## 결과 및 회고

세 가지 전략을 모두 시도한 끝에 GPT-4o-mini가 최종 선택되었다. 비용과 지연이라는 단점에도 불구하고, 키워드 추출 정확도와 검색 의도 파악 능력이 압도적이었다.

각 전략의 비교를 정리하면:

| 기준 | GPT-4o-mini | EXAONE (로컬) | FAISS |
|------|-------------|---------------|-------|
| 키워드 정확도 | 높음 | 중간 | 낮음 |
| 검색 의도 파악 | 가능 | 제한적 | 불가 |
| 응답 시간 | 500ms~1s | 200~500ms | 1~5ms |
| API 비용 | 있음 | 없음 | 없음 |
| GPU 메모리 | 없음 | 높음 (7.8B 모델) | 낮음 |
| 운영 안정성 | OpenAI 서버 의존 | 자체 관리 필요 | 안정적 |

이 프로젝트에서 배운 것은, **기능의 온/오프 제어가 운영에서 매우 중요하다**는 점이다. Summary API가 전체 검색 파이프라인의 병목이 될 수 있기 때문에, 빠르게 비활성화할 수 있는 메커니즘이 필수였다. `app.py` 라우터 주석 토글이라는 원시적인 방법이었지만, 실제 운영에서는 이 정도로 충분했다. 만약 규모가 커진다면 환경변수 기반 feature flag나 API Gateway 레벨의 라우팅 제어로 발전시킬 수 있을 것이다.
