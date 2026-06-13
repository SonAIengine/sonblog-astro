---
title: FastEmbed — ONNX 기반 경량 고성능 임베딩 라이브러리
description: Qdrant의 FastEmbed 라이브러리를 정리한다. ONNX Runtime 기반으로 PyTorch 없이 경량 임베딩을 생성하는
  방법, 서버리스 환경 활용, MTEB 벤치마크 성능 비교를 다룬다.
pubDatetime: 2025-07-15
tags:
- FastEmbed
- Qdrant
- 벡터검색
- 검색엔진
- ONNX
- 임베딩
- Search Engine
---


**FastEmbed**는 경량화·고성능 임베딩 생성을 목표로 개발된 Python 라이브러리이다. 

ONNX Runtime 기반으로 동작하여 의존성이 적고, 서버리스 환경(예: AWS Lambda)에서도 가볍게 실행할 수 있다.

|특징|설명|
|---|---|
|Light|PyTorch나 Transformers 대비 외부 의존성이 거의 없다.|
|Fast|ONNX Runtime을 통해 하드웨어별 최적화된 추론 속도를 제공한다.|
|Accurate|MTEB 벤치마크에서 우수한 성능을 내는 모델을 기본 사용한다.|
|Multilingual|다국어 모델을 포함해 폭넓은 모델을 지원한다.|

FastEmbed는 Qdrant와 쉽게 연동되어 **멀티모달 검색**, **밀집(dense)·희소(sparse) 임베딩**, **멀티벡터(multivector)**, **재랭킹** 등 다양한 시나리오에 활용할 수 있다.


## 1. FastEmbed 기본 사용: 텍스트 임베딩 생성

### 1.1 설치

```bash
pip install fastembed
```

### 1.2 모델 로드 및 데이터 준비

```python
from fastembed import TextEmbedding
from typing import List

documents: List[str] = [
    "FastEmbed is lighter than Transformers & Sentence-Transformers.",
    "FastEmbed is supported by and maintained by Qdrant.",
]

embedding_model = TextEmbedding()  # 기본 모델: BAAI/bge-small-en-v1.5
print("The model BAAI/bge-small-en-v1.5 is ready to use.")
```

### 1.3 임베딩 생성

```python
embeddings = list(embedding_model.embed(documents))
print(len(embeddings[0]))  # 384 차원
```

- 기본 모델은 384차원 벡터를 출력한다.
    
- 반환 타입은 `numpy.ndarray`이다.

## 2. FastEmbed × Qdrant: 벡터 검색 파이프라인

### 2.1 의존성 설치

```bash
pip install "qdrant-client[fastembed]>=1.14.2"
```

### 2.2 Qdrant 클라이언트 초기화

```python
from qdrant_client import QdrantClient, models

client = QdrantClient(":memory:")  # 인메모리 모드
```

### 2.3 컬렉션 생성

```python
model_name = "BAAI/bge-small-en"
client.create_collection(
    collection_name="test_collection",
    vectors_config=models.VectorParams(
        size=client.get_embedding_size(model_name),
        distance=models.Distance.COSINE,
    ),
)
```

### 2.4 데이터 업로드(임베딩 자동 생성)

```python
docs = [
    "Qdrant has a LangChain integration for chatbots.",
    "Qdrant has a LlamaIndex integration for agents.",
]
payloads = [{"source": "langchain-docs"}, {"source": "llamaindex-docs"}]
ids = [42, 2]

client.upload_collection(
    collection_name="test_collection",
    vectors=[models.Document(text=d, model=model_name) for d in docs],
    payload=[
        {"document": d, "source": p["source"]} for d, p in zip(docs, payloads)
    ],
    ids=ids,
)
```

### 2.5 쿼리 수행

```python
search_result = client.query_points(
    collection_name="test_collection",
    query=models.Document(
        text="Which integration is best for agents?",
        model=model_name,
    ),
).points
for point in search_result:
    print(point.payload["document"], point.score)
```


## 3. 고급 사용 사례

FastEmbed는 다양한 임베딩 유형과 검색 방식을 지원한다.

|유형|목적|핵심 포인트|
|---|---|---|
|Dense Embeddings|의미적 유사도 검색|기본 TextEmbedding + Qdrant 벡터 색인|
|Sparse Embeddings (miniCOIL)|정확한 키워드 매칭|Qdrant의 희소 벡터 색인 활용|
|Sparse Embeddings (SPLADE)|문서 검색 최적화|sparse retriever + Qdrant|
|Multivector (ColBERT)|토큰별 세밀한 매칭·재점수화|`max_sim` 비교기 사용|
|Reranking|1차 검색 결과 정밀 재정렬|Cross-Encoder 기반 재랭커|


## 4. Cross-Encoder 재랭킹 예시

### 4.1 환경 준비

```bash
pip install "qdrant-client[fastembed]>=1.14.1"
```

```python
from fastembed import TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder

dense_model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
reranker = TextCrossEncoder(model_name="jinaai/jina-reranker-v2-base-multilingual")
```

### 4.2 데이터 업로드

```python
descriptions = [
    "In 1431, Jeanne d'Arc is placed on trial on charges of heresy.",
    "A sci-fi adventure through space and time.",
    "A world-weary political journalist picks up the story of a woman's search.",
]
desc_emb = list(dense_model.embed(descriptions))

client = QdrantClient(":memory:")
client.create_collection(
    collection_name="movies",
    vectors_config={"embedding": models.VectorParams(
        size=dense_model.embedding_size, distance=models.Distance.COSINE)}
)

client.upload_points(
    collection_name="movies",
    points=[
        models.PointStruct(
            id=i,
            payload={"description": d},
            vector={"embedding": v},
        )
        for i, (d, v) in enumerate(zip(descriptions, desc_emb))
    ],
)
```

### 4.3 1차 검색

```python
query = "A story about a strong historically significant female figure."
query_vec = list(dense_model.query_embed(query))[0]

initial_hits = client.query_points(
    collection_name="movies",
    using="embedding",
    query=query_vec,
    with_payload=True,
    limit=10,
).points

candidates = [hit.payload["description"] for hit in initial_hits]
```

### 4.4 재랭킹

```python
scores = list(reranker.rerank(query, candidates))
ranked = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)

for rank, (doc, score) in enumerate(ranked, 1):
    print(f"{rank}. {doc} (score={score:.4f})")
```

- 재랭커는 토큰 수준 상호작용을 고려해 더 정밀한 순서를 제공한다.
    
- 일반적으로 **상위 K개**(예: 50~200개) 결과에만 재랭커를 적용해 속도와 정확도를 균형 있게 유지한다.
    


## 5. Sparse·Multivector 활용

### 5.1 miniCOIL / SPLADE 희소 벡터

```python
from fastembed import SparseEmbedding

sparse_model = SparseEmbedding(model_name="naver/miniCOIL")
sparse_vecs = list(sparse_model.embed(documents))

client.create_collection(
    collection_name="sparse_collection",
    sparse_vectors_config={"text": {}}
)
client.upload_points(
    collection_name="sparse_collection",
    points=[
        models.PointStruct(id=i, vector={"text": v}) for i, v in enumerate(sparse_vecs)
    ]
)
```

- Qdrant에서 `sparse_vectors` 설정을 통해 희소 벡터 전용 인덱스를 사용한다.
    
- 검색 시 `using="text"` 파라미터 지정으로 dot-product 기반 정확 검색이 가능하다.
    

### 5.2 ColBERT Multivector

```python
from fastembed import MultiVectorEmbedding

mv_model = MultiVectorEmbedding(model_name="colbert-ir/colbertv2")
mv_vectors = list(mv_model.embed(documents))  # 각 문서당 다중 벡터 리스트

client.create_collection(
    collection_name="colbert_collection",
    vectors_config=models.VectorParams(
        size=mv_model.vector_size,
        distance=models.Distance.COSINE,
        multivector_config=models.MultiVectorConfig(comparator="max_sim"),
    ),
)

client.upload_points(
    collection_name="colbert_collection",
    points=[
        models.PointStruct(id=i, vector=vecs) for i, vecs in enumerate(mv_vectors)
    ],
)
```

- `max_sim` 비교기로 다중 벡터 간 최대 유사도를 사용한다.
    
- ColBERT는 1차 검색 후보 재점수화(rescoring)나 소규모 데이터에서 직접 검색용으로 적합하다.
    


## 6. 정리

1. **FastEmbed**는 ONNX Runtime 기반으로 가볍고 빠르며 정확한 임베딩 생성을 지원한다.
    
2. **Qdrant**와의 통합을 통해 Dense, Sparse, Multivector 임베딩을 모두 저장·검색할 수 있다.
    
3. **Cross-Encoder 재랭커**를 활용하여 1차 검색 결과를 정밀하게 재배열할 수 있다.
    
4. Sparse·Multivector·재랭킹 조합으로 **속도와 정확도**를 상황에 맞춰 최적화할 수 있다.
    

FastEmbed와 Qdrant를 함께 사용하면 **경량화된 임베딩 파이프라인**과 **고성능 벡터 검색 엔진**을 단일 스택으로 구축할 수 있다. 이를 통해 멀티모달 검색, 문서 검색, 챗봇, 에이전트 등 다양한 애플리케이션에서 빠르고 정확한 결과를 얻을 수 있다.