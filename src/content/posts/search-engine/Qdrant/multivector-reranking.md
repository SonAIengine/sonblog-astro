---
title: Qdrant Multivector Reranking — ColBERT 멀티벡터 저비용 운용 전략
description: Qdrant에서 ColBERT 같은 Late-Interaction 모델의 멀티벡터를 효율적으로 운용하는 방법을 정리한다. RAM
  절감, 삽입 지연 최소화, 2단계 검색(oversample + rescore) 전략을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Reranker
- ColBERT
- 멀티벡터
- Search Engine
---


멀티벡터(multivector) 기능은 Qdrant가 제공하는 핵심 특징 가운데 하나이다. 

그러나 문서-수준이 아닌 토큰-수준 벡터를 다루는 특성상, 무작정 활용하면 **RAM 급증·삽입 지연·계산 낭비**로 이어지기 쉽다. 

본 글에서는 ColBERT 같은 Late-Interaction 모델을 예로 들어, Qdrant에서 멀티벡터를 **저비용·고정밀**로 운용하는 실전 요령을 정리한다.


## 1. 멀티벡터란 무엇인가

일반적인 벡터 검색 엔진은 하나의 문서를 단일 벡터로 표현한다. 짧은 텍스트에는 충분하지만, 긴 문서에서는 풀링 과정에서 정보가 손실된다.  

멀티벡터 표현은 **문서 → 여러 개의 토큰/구문 벡터**로 변환하여 쿼리 토큰과 문서 일부를 정밀 매칭한다. ColBERT는 이러한 토큰-수준 벡터에 `MaxSim` 함수를 적용해 Late-Interaction 방식으로 점수를 계산한다.


## 2. 재랭킹(rescoring)의 개념

1. **1단계**: 빠른 Dense 모델로 후보 문서를 가져온다.
    
2. **2단계**: ColBERT 등 정밀하지만 느린 모델이 후보 집합을 다시 점수화한다.

이 과정에서 멀티벡터는 **재랭킹 전용**으로 쓰이는 경우가 많다.


## 3. “벡터 전부 HNSW 인덱싱”이 문제인 이유

Late-Interaction 모델 한 문서는 수백 개 토큰 벡터를 생성한다. 이들을 모두 HNSW로 인덱싱하면

- RAM 사용량 급증
    
- HNSW 그래프 갱신으로 삽입 속도 저하

재랭킹 단계에서는 HNSW 탐색이 굳이 필요 없으므로, 멀티벡터 필드의 인덱싱을 **비활성화**하여 자원을 절약할 수 있다.

```python
from qdrant_client import QdrantClient, models

client = QdrantClient("http://localhost:6333")
client.create_collection(
    collection_name="dense_multivector_demo",
    vectors_config={
        "dense": models.VectorParams(
            size=384,
            distance=models.Distance.COSINE            # 1단계 검색용, 인덱싱 유지
        ),
        "colbert": models.VectorParams(
            size=128,
            distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM
            ),
            hnsw_config=models.HnswConfigDiff(m=0)      # HNSW 인덱싱 OFF
        ),
    },
)
```

- `m=0`으로 설정하면 해당 벡터 스페이스에 HNSW 그래프가 생성되지 않는다.
    
- 결과: **RAM 절감·업로드 가속·CPU 부하 감소** 효과가 있다.


## 4. FastEmbed로 ColBERT 멀티벡터 생성

### 4.1 설치 및 클라이언트 초기화

```bash
pip install "qdrant-client[fastembed]>=1.14.2"
```

```python
from qdrant_client import QdrantClient, models
client = QdrantClient("http://localhost:6333")
```

### 4.2 문서·쿼리 임베딩

```python
from fastembed import TextEmbedding, LateInteractionTextEmbedding

docs = [
    "Artificial intelligence is used in hospitals for cancer diagnosis and treatment.",
    "Self-driving cars use AI to detect obstacles and make driving decisions.",
    "AI is transforming customer service through chatbots and automation.",
]
query_text = "How does AI help in medicine?"

dense_docs   = [models.Document(text=d, model="BAAI/bge-small-en")   for d in docs]
colbert_docs = [models.Document(text=d, model="colbert-ir/colbertv2.0") for d in docs]

dense_query   = models.Document(text=query_text, model="BAAI/bge-small-en")
colbert_query = models.Document(text=query_text, model="colbert-ir/colbertv2.0")
```

### 4.3 컬렉션 생성

앞서 본 예시와 동일하게 `dense`는 인덱싱 유지, `colbert`는 인덱싱 해제하여 만든다.

### 4.4 벡터 업로드

```python
points = [
    models.PointStruct(
        id=i,
        vector={
            "dense":   dense_docs[i],
            "colbert": colbert_docs[i],
        },
        payload={"text": docs[i]},
    )
    for i in range(len(docs))
]

client.upload_points(
    collection_name="dense_multivector_demo",
    points=points,
    batch_size=8,
)
```

### 4.5 검색 + 재랭킹 한 번에 실행

```python
results = client.query_points(
    collection_name="dense_multivector_demo",
    prefetch=models.Prefetch(                    # 1단계: dense 검색
        query=dense_query,
        using="dense",
    ),
    query=colbert_query,                         # 2단계: ColBERT 재랭킹
    using="colbert",
    limit=3,
    with_payload=True,
)
```

- `prefetch` 결과가 후보 집합을 구성한다.
    
- `query/using="colbert"`가 `MaxSim` 기반 토큰-매칭으로 재랭킹한다.
    
- 최종 상위 3개 문서를 반환한다.


## 5. 요약

- **멀티벡터는 토큰-수준 정밀 매칭**으로 Late-Interaction 재랭킹에 탁월하다.
    
- Qdrant에서는 **벡터별 인덱싱 여부**를 자유롭게 설정할 수 있다.
    
    - Dense 벡터: HNSW 인덱싱 유지 → 빠른 1차 검색
        
    - ColBERT 벡터: `m=0` → 인덱싱 해제 → 자원 절약
        
- FastEmbed + Qdrant 조합으로 ColBERT 파이프라인을 손쉽게 구축할 수 있다.
    
- 한 번의 API 호출로 **후보 검색 + 토큰-정밀 재랭킹**을 수행하여 효율과 정확도를 동시에 확보할 수 있다.
    

이 가이드를 적용하면 멀티벡터 기반 재랭킹을 RAM·연산 비용 걱정 없이 실서비스에 도입할 수 있다. 
Qdrant Cloud를 이용하면 관리형 환경에서도 동일한 구성을 즉시 활용할 수 있다.