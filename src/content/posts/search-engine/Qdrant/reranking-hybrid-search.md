---
title: Qdrant 하이브리드 검색 + ColBERT 재랭킹 구현 가이드
description: Qdrant에서 Dense, Sparse, Late-Interaction 임베딩을 한 컬렉션에 저장하고 하이브리드 검색 후
  ColBERT로 재랭킹하는 전 과정을 정리한다. Python 예시 코드와 함께 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 하이브리드검색
- Reranker
- ColBERT
- Search Engine
---


본 문서는 **Dense + Sparse + Late-Interaction** 임베딩을 한 컬렉션에 저장하고,  
하이브리드 검색 후 ColBERT로 재랭킹하는 전 과정을 예시 코드와 함께 설명한다.  

모든 예시는 Python 3.9 이상, Qdrant 서버가 `http://localhost:6333` 에 구동되어 있다는 전제하에 작성되었다.


## 1. 아키텍처 개요

| 단계           | 내용                                                                |
| ------------ | ----------------------------------------------------------------- |
| **문서 인제스트**  | 문서 → ① Dense (BGE) ② Sparse (BM25) ③ ColBERT 토큰 벡터 생성 → Qdrant 저장 |
| **검색 쿼리**    | 쿼리 → 동일 세 가지 임베딩 생성                                               |
| **하이브리드 검색** | Dense + Sparse 두 서브쿼리를 `prefetch` 로 병렬 수행                         |
| **재랭킹**      | ColBERT 멀티벡터로 후보를 `MaxSim` 기반 재정렬                                 |
| **결과**       | 최종 상위 N개 문서 반환                                                    |

멀티벡터(ColBERT) 스페이스는 **HNSW 인덱스를 끈(m = 0)** 상태로 저장해 RAM·삽입 시간을 최소화한다.


## 2. 준비 사항

```bash
pip install qdrant-client[fastembed]>=1.14.2
pip install fastembed
```

모델 이름

- Dense : `sentence-transformers/all-MiniLM-L6-v2`
    
- Sparse : `Qdrant/bm25`
    
- Late-Interaction : `colbert-ir/colbertv2.0`


## 3. 인제스트 단계

### 3.1 임베딩 생성

```python
from fastembed import (
    TextEmbedding,
    SparseTextEmbedding,
    LateInteractionTextEmbedding,
)

docs = [
    "Artificial intelligence is used in hospitals for cancer diagnosis and treatment.",
    "Self-driving cars use AI to detect obstacles and make driving decisions.",
    "AI is transforming customer service through chatbots and automation.",
]

dense_model   = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2")
sparse_model  = SparseTextEmbedding("Qdrant/bm25")
colbert_model = LateInteractionTextEmbedding("colbert-ir/colbertv2.0")

dense_vecs   = list(dense_model.embed(docs))
sparse_vecs  = list(sparse_model.embed(docs))
colbert_vecs = list(colbert_model.embed(docs))      # 리스트(토큰수)→128차원 벡터 배열
```

### 3.2 컬렉션 생성

```python
from qdrant_client import QdrantClient, models

client = QdrantClient("http://localhost:6333")

client.create_collection(
    collection_name="hybrid-search",
    vectors_config={
        "all-MiniLM-L6-v2": models.VectorParams(
            size=len(dense_vecs[0]),
            distance=models.Distance.COSINE,
        ),
        "colbertv2.0": models.VectorParams(
            size=len(colbert_vecs[0][0]),
            distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM,
            ),
            hnsw_config=models.HnswConfigDiff(m=0),  # 인덱싱 OFF
        ),
    },
    sparse_vectors_config={
        "bm25": models.SparseVectorParams(
            modifier=models.Modifier.IDF   # IDF 자동 적용
        )
    },
)
```

### 3.3 데이터 업서트

```python
from qdrant_client.models import PointStruct

points = [
    PointStruct(
        id=i,
        vector={
            "all-MiniLM-L6-v2": dense_vecs[i],
            "bm25": sparse_vecs[i].as_object(),
            "colbertv2.0": colbert_vecs[i],
        },
        payload={"document": docs[i]},
    )
    for i in range(len(docs))
]

client.upsert(
    collection_name="hybrid-search",
    points=points,
    batch_size=8,
)
```


## 4. 검색·재랭킹 단계

### 4.1 쿼리 임베딩

```python
query = "How does AI help in medicine?"

dense_q   = next(dense_model.query_embed(query))
sparse_q  = next(sparse_model.query_embed(query))
colbert_q = next(colbert_model.query_embed(query))
```

### 4.2 하이브리드 검색 (Dense + Sparse)

```python
prefetch = [
    models.Prefetch(
        query=dense_q,
        using="all-MiniLM-L6-v2",
        limit=20,
    ),
    models.Prefetch(
        query=models.SparseVector(**sparse_q.as_object()),
        using="bm25",
        limit=20,
    ),
]
```

### 4.3 ColBERT 재랭킹

```python
results = client.query_points(
    collection_name="hybrid-search",
    prefetch=prefetch,           # 후보 20+20
    query=colbert_q,             # 토큰-레벨 MaxSim
    using="colbertv2.0",
    limit=10,                    # 최종 상위 10
    with_payload=True,
)
for r in results.points:
    print(r.payload["document"], "| score:", r.score)
```


## 5. 베스트 프랙티스

1. **멀티벡터 인덱싱 OFF**
    
    - `hnsw_config.m = 0` 로 RAM·삽입 속도 최적화
        
    - 재랭킹 전용 필드에는 인덱싱이 불필요하다.
        
2. **Dense + Sparse 후보 집합 축소**
    
    - 1차 검색 `limit` 값을 작게 잡아 ColBERT 계산량을 제어한다.
        
3. **지속적 품질 모니터링**
    
    - 정기적으로 Precision@k, MRR 등을 평가하여 모델·파라미터를 조정한다.
        
4. **지연 시간 vs 정확도 균형**
    
    - 재랭킹은 비용이 크므로 반드시 축소된 후보 집합에만 적용한다.
        


## 6. 결론

Qdrant는 한 컬렉션 안에서 **Dense + Sparse + 멀티벡터**를 동시에 저장하고,  
`prefetch` / `multivector` 기능으로 **하이브리드 검색→ColBERT 재랭킹**을 한 번의 호출로 수행할 수 있다.  
인덱스 사용 여부를 필드 단위로 제어할 수 있으므로 성능·자원 사용을 세밀하게 최적화할 수 있다.

Qdrant Cloud를 이용하면 동일 구성을 관리형 환경에서 즉시 활용할 수 있다. 지금 바로 무료로 가입하여 고정밀 검색 파이프라인을 구축해 보자.