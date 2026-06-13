---
title: FAISS 벡터 인덱스 적용과 GPU 디바이스 최적화
description: 시맨틱 검색 API에 FAISS 벡터 인덱스를 도입하여 키워드 확장 검색을 구현하고, GPU/CPU 디바이스 분리 및 텐서
  타입 이슈를 해결한 과정을 정리한다.
pubDatetime: 2026-02-18
tags:
- FAISS
- GPU
- PyTorch
- 벡터검색
- KoSimCSE
- 키워드확장
- Python
- Search Engine
---


# FAISS 벡터 인덱스 적용과 GPU 디바이스 최적화

상품 검색에서 사용자가 "청소기"를 검색했을 때, "진공청소기", "무선청소기", "물걸레청소기" 같은 관련 키워드로 확장할 수 있다면 검색 커버리지가 넓어진다. 이 키워드 확장을 위해 search-semantic-api에 FAISS 벡터 인덱스를 도입했다. 2024년 11월, 이틀간의 집중 개발과 디버깅 과정에서 겪은 GPU 디바이스 관리, 텐서 타입 변환, 유사도 임계값 튜닝 문제를 정리한다.

## 배경: 키워드 확장이 필요한 이유

기존 상품 요약(Summary) 기능은 GPT-4o-mini를 호출하여 문장형 검색어에서 핵심 키워드를 추출하는 방식이었다. "겨울에 입기 좋은 따뜻한 코트"라는 검색어를 GPT에 넘기면 "겨울 코트 보온"이라는 키워드를 돌려준다. 정확도는 높지만 두 가지 문제가 있었다.

첫째, OpenAI API 호출 비용이다. 검색 요청마다 GPT를 호출하면 비용이 누적된다. 둘째, 응답 지연이다. GPT 응답에 평균 500ms~1초가 걸리고, 이것이 검색 응답 시간에 직접 더해진다.

FAISS(Facebook AI Similarity Search)는 벡터 유사도 검색을 위한 라이브러리로, 사전 구축된 인덱스에서 밀리초 단위로 유사 키워드를 찾을 수 있다. GPT 호출 대신 FAISS로 키워드를 확장하면 비용과 지연 모두 해결할 수 있다는 판단이었다.

## 아키텍처 설계

FAISS 기반 키워드 확장의 전체 흐름이다.

```mermaid
flowchart LR
    A[검색어 입력] --> B[KoSimCSE 임베딩]
    B --> C[FAISS 인덱스 검색]
    C --> D[유사 키워드 50개]
    D --> E[Min-Max 정규화]
    E --> F[임계값 필터링]
    F --> G[형태소 분석]
    G --> H[중복 제거]
    H --> I{반복 완료?}
    I -->|아니오| B
    I -->|예| J[확장 키워드 반환]
```

핵심 아이디어는 **반복적 키워드 확장(Iterative Expansion)**이다. 1회차에서 원본 검색어로 FAISS를 검색하고, 결과에서 새 키워드를 추출한 뒤, 2회차에서 그 키워드로 다시 FAISS를 검색한다. 이렇게 하면 1차에서 "청소기 → 진공청소기"를 찾고, 2차에서 "진공청소기 → 로봇청소기, 사이클론"까지 확장할 수 있다.

### 기술 스택

| 구성 요소 | 기술 | 역할 |
|-----------|------|------|
| 벡터 인덱스 | FAISS (faiss-cpu 1.9.0) | 코사인 유사도 기반 근사 최근접 이웃 검색 |
| 임베딩 모델 | KoSimCSE-roberta-multitask | 한국어 문장 → 벡터 변환 |
| 형태소 분석 | KoNLPy Okt | 명사 추출, 중복 키워드 필터링 |
| 키워드 데이터 | keywords.csv | FAISS 인덱스 ID와 매핑되는 키워드 |
| 인덱스 저장소 | HuggingFace Hub | `x2bee/Faiss-index-model` 레포에서 관리 |

## 핵심 구현

### FaissSearch 클래스

```
# 커밋: fix: faiss사용
# 날짜: 2024-11-18 17:28
```

```python
# utils/faiss.py
class FaissSearch:
    def __init__(self, index_path, key_data_path, tokenizer_cse, model_cse, device):
        self.okt = Okt()
        self.tokenizer_cse = tokenizer_cse
        self.model_cse = model_cse.to(device)
        self.index = faiss.read_index(index_path)
        self.key_data = pd.read_csv(
            key_data_path, usecols=["keywords"], dtype={"keywords": "string"}
        )
        self.device = device

    @staticmethod
    def mean_pooling(model_output, attention_mask):
        token_embeddings = model_output
        input_mask_expanded = (
            attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
        )
        return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(
            input_mask_expanded.sum(1), min=1e-9
        )

    @lru_cache(maxsize=1000)
    def cached_nouns(self, text):
        return set(self.okt.nouns(text))
```

`mean_pooling`은 KoSimCSE 모델의 출력에서 문장 임베딩을 추출하는 표준 방법이다. 각 토큰의 임베딩을 attention mask를 고려하여 평균한다. 패딩 토큰은 mask 값이 0이므로 자동으로 제외된다.

`cached_nouns`에 `@lru_cache`를 적용하여 동일 텍스트의 형태소 분석 결과를 캐싱한다. KoNLPy Okt의 형태소 분석은 JVM 호출이 포함되어 있어 상대적으로 느리기 때문에, 캐싱의 효과가 크다.

### FAISS 검색 메서드

```python
def query_faiss(self, query: str, score_threshold=0.5):
    # 쿼리 임베딩 생성
    inputs = self.tokenizer_cse(
        query, padding="max_length", truncation=True,
        max_length=32, return_tensors="pt",
    ).to(self.device)
    embedding, _ = self.model_cse(**inputs, return_dict=False)
    sentence_embeddings = self.mean_pooling(embedding, inputs["attention_mask"])
    sentence_embeddings = F.normalize(sentence_embeddings, p=2, dim=1)
    np_query_embedding = (
        sentence_embeddings.cpu().detach().numpy().astype("float32").reshape(1, -1)
    )

    # FAISS 검색
    D, I = self.index.search(np_query_embedding, 50)
    if D.size == 0 or I.size == 0:
        return []

    # 텐서 변환 + 유효성 검증
    I = torch.tensor(I, dtype=torch.int64).to(self.device)
    D = torch.tensor(D).to(self.device)

    # Min-Max 정규화
    MXD, MND = D.max(), D.min()
    keywords_with_scores = []
    for i in range(len(I[0])):
        idx = int(I[0][i])
        if idx < 0 or idx >= len(self.key_data):
            continue
        kw = self.key_data["keywords"].iloc[idx]
        score = max(0, 1 - ((D[0][i] - MND) / (MXD - MND)))
        if score < score_threshold:
            break
        keywords_with_scores.append((kw, score, D[0][i]))

    return self.remove_duplicate_keywords(keywords_with_scores, self.cached_nouns(query))
```

FAISS가 반환하는 `D`(거리)와 `I`(인덱스)는 numpy 배열이다. 이것을 `torch.tensor`로 변환하여 GPU에서 처리하는데, 이 부분에서 여러 이슈가 발생했다. 트러블슈팅 섹션에서 자세히 다룬다.

Min-Max 정규화는 FAISS 거리 값을 0~1 사이의 점수로 변환한다. 코사인 유사도 기반 인덱스이므로 거리가 작을수록 유사하다. `1 - 정규화된_거리`를 하면 유사할수록 높은 점수가 된다.

### 반복적 키워드 확장

```python
def expand_keywords_with_faiss(self, initial_query: str, score_threshold=0.5):
    expanded_keywords = set()
    query = initial_query

    for iteration in range(2):
        top_docs = self.query_faiss(query, score_threshold)
        if not top_docs:
            break

        all_morphemes = {
            m for doc in top_docs
            for m in self.okt.morphs(doc[0])
            if len(m) > 1
        }
        new_keywords = all_morphemes - expanded_keywords
        expanded_keywords.update(new_keywords)
        query = " ".join(new_keywords)

        if not query.strip():
            break

    return " ".join(expanded_keywords)
```

반복 횟수는 처음 3회로 설정했다가 2회로 줄였다. 3회차에서는 이미 확장된 키워드의 변형만 나올 뿐 새로운 의미의 키워드가 거의 추가되지 않았기 때문이다.

## 트러블슈팅

### 1. GPU 디바이스 전역 관리

```
# 커밋: fix: device
# 날짜: 2024-11-11 14:41
```

FAISS 도입 전에 먼저 해결해야 할 문제가 있었다. `model_service.py`에서 각 모델의 디바이스 설정이 제각각이었다. Object Detection 모델은 GPU, 텍스트 유사도 모델도 GPU, 이미지 분류 모델도 GPU. 이렇게 되면 GPU 메모리가 부족해진다.

```python
# 수정 전: 각 모델이 개별적으로 device 결정
model.to(torch.device("cuda"))

# 수정 후: 전역 device 변수 사용
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
cpu_device = torch.device("cpu")
```

GPU가 필수인 모델(Object Detection, Vision Transformer, Reranker)은 `device`에, 나머지(텍스트 유사도, 이미지 분류)는 `cpu_device`에 할당하는 방식으로 정리했다. 이틀 뒤 FAISS를 도입할 때 이 구조가 그대로 활용되었다.

### 2. FAISS 인덱스 타입 버그

```
# 커밋: fix: faiss
# 날짜: 2024-11-18 19:32
```

FAISS의 `index.search()`가 반환하는 인덱스 배열 `I`의 타입이 문제였다. FAISS는 numpy `int64`를 반환하지만, 이것을 `torch.tensor(I)`로 변환하면 기본적으로 `torch.int64`가 아니라 텐서의 기본 dtype이 적용될 수 있다. 이 텐서의 값을 `pandas.iloc[]`에 넘기면 float 인덱스로 해석되어 `IndexError`가 발생한다.

```python
# 수정 전: dtype 미지정
I = torch.tensor(I).to(self.device)
idx = I[0][i]  # float tensor → iloc에서 오류

# 수정 후: int64 명시 + int() 캐스팅
I = torch.tensor(I, dtype=torch.int64).to(self.device)
idx = int(I[0][i])
if idx < 0 or idx >= len(self.key_data):
    continue
```

`dtype=torch.int64`를 명시하고, `int()`로 Python 정수로 변환한 뒤, 범위 유효성까지 검증하는 방어 코드를 추가했다.

### 3. 키워드 중복 제거 함수의 반환값 구조

```
# 커밋: fix: faiss
# 날짜: 2024-11-18 19:35
```

`remove_duplicate_keywords`가 `(keyword, score)` 튜플의 리스트를 반환하는데, `expand_keywords_with_faiss`에서 이것을 `for doc, _, _ in top_docs`로 unpack하고 있었다. 튜플이 2개 원소인데 3개로 unpack하면 `ValueError`가 발생한다.

```python
# 수정 전
for doc, _, _ in top_docs:
    morphemes = self.okt.morphs(doc)

# 수정 후
all_morphemes = {
    m for doc in top_docs
    for m in self.okt.morphs(doc[0])
    if len(m) > 1
}
```

comprehension으로 변경하고 `doc[0]`으로 키워드만 접근하도록 수정했다.

### 4. 유사도 임계값 튜닝

```
# 커밋: fix: 유사도 0.5, fix: 유사도 0.3
# 날짜: 2024-11-18 19:43~19:49
```

처음 임계값을 0.6으로 설정했더니 결과가 너무 적었다. "청소기"를 검색해도 2~3개밖에 안 나온다. 0.5로 낮추니 나아졌지만 여전히 부족해서, 최종적으로 0.3까지 낮췄다.

| 임계값 | 평균 결과 수 | 키워드 품질 |
|--------|------------|-------------|
| 0.6 | 2~3개 | 매우 관련성 높음 |
| 0.5 | 5~8개 | 관련성 높음 |
| 0.3 | 15~25개 | 다양하지만 일부 노이즈 포함 |

0.3에서는 확장 키워드에 약간의 노이즈가 포함되지만, 검색 커버리지 확대 효과가 더 크다고 판단했다.

### 5. 반복 횟수와 검색 결과 수 튜닝

```
# 커밋: fix: 반복 2로
# 날짜: 2024-11-18 19:54~19:55
```

반복 횟수를 3에서 2로, 검색 결과 수를 50에서 10으로 줄이는 시도를 했다. 그런데 검색 결과 10개에서는 키워드 다양성이 부족해서 바로 50개로 원복했다. 반복 횟수 2는 유지했다.

## FAISS 비활성화와 교훈

```
# 커밋: fix: faiss off
# 날짜: 2024-11-20 10:10
```

FAISS를 이틀간 실험한 뒤, 운영에서는 비활성화하고 GPT 기반 요약으로 복귀했다. 코드 자체는 완성되었고 `utils/faiss.py`에 그대로 남아 있지만, `model_service.py`에서 FAISS 인스턴스 생성 코드를 주석 처리했다.

비활성화한 이유는 키워드 품질이었다. FAISS는 벡터 유사도 기반이라 의미적으로 가까운 단어를 잘 찾지만, GPT처럼 검색 의도를 이해하고 적절한 키워드를 생성하지는 못한다. 예를 들어 "선물용 향수 추천"에 대해 GPT는 "여성향수, 남성향수, 니치향수, 선물세트"를 생성하지만, FAISS는 "향기, 냄새, 방향제, 디퓨저" 같은 의미적 유사어를 반환한다. 이커머스 검색에서는 전자가 더 유용하다.

하지만 이 과정에서 얻은 것들이 있다.

**GPU 디바이스 관리 패턴**: GPU 모델과 CPU 모델을 명확히 분리하고, 전역 device 변수로 일관성을 유지하는 패턴을 정립했다. 이 패턴은 이후 Reranker 모델 도입 시에도 그대로 활용되었다.

**텐서 타입 주의**: FAISS와 PyTorch, pandas를 함께 쓸 때는 데이터 타입 변환에 각별히 주의해야 한다. numpy → torch → Python 네이티브 타입 사이의 변환에서 버그가 발생하기 쉽다.

**LRU 캐시 활용**: KoNLPy 형태소 분석처럼 JVM 호출이 포함된 비싼 연산에 `@lru_cache`를 적용하면 상당한 성능 향상을 얻을 수 있다.

## 시행착오 타임라인

| 날짜 | 커밋 | 내용 |
|------|------|------|
| 11-11 14:41 | fix: device | 전역 device 변수 설정, GPU/CPU 모델 분리 |
| 11-11 14:46 | fix: device | 불필요한 Object Detection GPU 할당 제거 |
| 11-18 17:28 | fix: faiss사용 | FAISS 최초 도입, `utils/faiss.py` 생성 |
| 11-18 19:15 | fix: device | device 외부 주입, FP16 적용 |
| 11-18 19:30 | fix: faiss | device="cuda" 하드코딩, `.to(device)` 추가 |
| 11-18 19:32 | fix: faiss | 인덱스 타입 `torch.int64` 명시, 유효성 검증 |
| 11-18 19:35 | fix: faiss | unpack 구조 수정 (`doc[0]` 접근) |
| 11-18 19:43 | fix: 유사도 0.5 | score_threshold 0.6 → 0.5 |
| 11-18 19:49 | fix: 유사도 0.3 | score_threshold 0.5 → 0.3 |
| 11-18 19:54 | fix: 반복 2로 | 반복 3→2, 검색 결과 50→10 |
| 11-18 19:55 | fix: 반복 2로 | 검색 결과 10→50 원복 |
| 11-20 10:10 | fix: faiss off | FAISS 비활성화, GPT로 복귀 |
