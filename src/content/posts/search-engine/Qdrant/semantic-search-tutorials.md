---
title: Qdrant 시맨틱 검색 튜토리얼 — 5분 만에 검색 엔진 만들기
description: Qdrant와 Sentence Transformer를 활용해 간단한 시맨틱 검색 엔진을 만드는 튜토리얼을 정리한다. NeuralSearcher
  클래스 구현, 쿼리 임베딩, 필터 결합 검색까지 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 시맨틱검색
- Sentence Transformer
- 튜토리얼
- Search Engine
---


## 1. 5 분 만에 만드는 간단한 시맨틱 검색 엔진

### 1.1 준비 사항

- Python 최신 버전
    
- 가상 환경(예: `python -m venv tutorial-env && source tutorial-env/bin/activate`)
    
- 필수 라이브러리
    

```bash
pip install -U sentence-transformers qdrant-client>=1.7.1
```

### 1.2 코드 개요

```python
from qdrant_client import QdrantClient, models
from sentence_transformers import SentenceTransformer

encoder = SentenceTransformer("all-MiniLM-L6-v2")
client = QdrantClient(":memory:")           # 인메모리 모드
docs = [...]                                # 책 메타데이터
client.create_collection(
    "my_books",
    vectors_config=models.VectorParams(
        size=encoder.get_sentence_embedding_dimension(),
        distance=models.Distance.COSINE,
    ),
)
client.upload_points(
    "my_books",
    [
        models.PointStruct(
            id=i,
            vector=encoder.encode(d["description"]).tolist(),
            payload=d,
        )
        for i, d in enumerate(docs)
    ],
)
```

### 1.3 질의 예시

```python
hits = client.query_points(
    collection_name="my_books",
    query=encoder.encode("alien invasion").tolist(),
    limit=3,
).points
```

필터링 예시

```python
hits = client.query_points(
    "my_books",
    query=encoder.encode("alien invasion").tolist(),
    query_filter=models.Filter(
        must=[models.FieldCondition(key="year",
               range=models.Range(gte=2000))]
    ),
    limit=1,
).points
```


## 2. Sentence Transformers + Qdrant로 뉴럴 검색 서비스 구축

### 2.1 데이터 준비

```bash
wget https://storage.googleapis.com/generall-shared-data/startups_demo.json
pip install sentence-transformers numpy pandas tqdm
```

```python
from sentence_transformers import SentenceTransformer
import pandas as pd, numpy as np, json, tqdm

model = SentenceTransformer("all-MiniLM-L6-v2", device="cuda")   # GPU 없으면 cpu
df = pd.read_json("startups_demo.json", lines=True)
vectors = model.encode(
    [f"{r.alt}. {r.description}" for r in df.itertuples()],
    show_progress_bar=True,
)
np.save("startup_vectors.npy", vectors, allow_pickle=False)
```

### 2.2 Qdrant 실행

```bash
docker pull qdrant/qdrant
docker run -p 6333:6333 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant
```

### 2.3 벡터 업로드

```python
from qdrant_client import QdrantClient, models

client = QdrantClient("http://localhost:6333")
client.create_collection(
    "startups",
    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE),
)
payload_iter = map(json.loads, open("startups_demo.json"))
vectors = np.load("startup_vectors.npy")

client.upload_collection(
    "startups",
    vectors=vectors,
    payload=payload_iter,
    batch_size=256,
)
```

### 2.4 FastAPI 서비스

```python
from fastapi import FastAPI
from neural_searcher import NeuralSearcher    # 자체 클래스

app = FastAPI()
searcher = NeuralSearcher("startups")

@app.get("/api/search")
def search(q: str):
    return {"result": searcher.search(q)}

# 실행: uvicorn service:app --reload
```

`NeuralSearcher` 클래스는 Sentence Transformer로 쿼리를 임베딩하고 `client.query_points`로 검색한다.


## 3. FastEmbed + Qdrant로 하이브리드 검색 서비스 구축

### 3.1 환경 설정

```bash
pip install "qdrant-client[fastembed]>=1.14.2"  # fastembed>=0.6.1 포함
```

### 3.2 컬렉션 구성

```python
dense_vec_name  = "dense"
sparse_vec_name = "sparse"
dense_model     = "sentence-transformers/all-MiniLM-L6-v2"
sparse_model    = "prithivida/Splade_PP_en_v1"

client.create_collection(
    "startups",
    vectors_config={
        dense_vec_name: models.VectorParams(
            size=client.get_embedding_size(dense_model),
            distance=models.Distance.COSINE)
    },
    sparse_vectors_config={sparse_vec_name: models.SparseVectorParams()},
)
```

### 3.3 업로드 및 인퍼런스

`client.upload_collection`에 `models.Document(text, model=...)`을 사용하면 FastEmbed가 자동으로 배치·병렬 인코딩 후 업로드한다.

### 3.4 하이브리드 검색 구현

```python
search_result = client.query_points(
    collection_name="startups",
    query=models.FusionQuery(fusion=models.Fusion.RRF),
    prefetch=[
        models.Prefetch(
            query=models.Document(text=q, model=dense_model),
            using=dense_vec_name,
        ),
        models.Prefetch(
            query=models.Document(text=q, model=sparse_model),
            using=sparse_vec_name,
        ),
    ],
    limit=5,
).points
```

RRF(Reciprocal Rank Fusion) 또는 DBSF(Distribution-Based Score Fusion)로 두 결과를 합친다.


## 4. 검색 품질 측정 및 HNSW 튜닝

### 4.1 평가 지표

- **precision@k**: 상위 k개 결과 중 정답 비율
    
- 전체 파이프라인 평가는 MRR, nDCG 등을 사용 가능
    
- ANN 알고리즘 자체 평가는 precision@k가 적합하다.
    

### 4.2 Exact 모드로 기준값 확보

```python
ann_hits = client.query_points(..., limit=k).points
knn_hits = client.query_points(
    ..., limit=k,
    search_params=models.SearchParams(exact=True)
).points
precision = len({h.id for h in ann_hits} & {h.id for h in knn_hits}) / k
```

### 4.3 HNSW 파라미터 조정

기본값 `m=16`, `ef_construct=100`이다. 품질을 높이고자 한다면:

```python
client.update_collection(
    "arxiv-titles",
    hnsw_config=models.HnswConfigDiff(m=32, ef_construct=200),
)
```

인덱싱 완료 후 precision@k를 다시 계산하여 향상 여부를 확인한다.


## 5. 종합 네트워킹·운영 팁

- 컨테이너·클러스터 환경에서는 **포트 6333(HTTP), 6334(gRPC), 6335(클러스터 통신)**을 모두 열어야 한다.
    
- 다중 노드일 경우 각 인스턴스가 동일 포트로 상호 통신 가능해야 하며, 클라이언트는 6333 또는 6334에 접근하면 된다.


## 6. 결론 및 다음 단계

- Sentence Transformers 또는 FastEmbed를 통해 **Dense·Sparse‧Multivector** 임베딩을 생성할 수 있다.
    
- Qdrant는 메모리·온디스크 저장소, HNSW·Sparse 인덱스를 조합하여 고성능 벡터 검색을 제공한다.
    
- 하이브리드 검색은 RRF·DBSF 등 융합 기법으로 의미·키워드 양쪽을 모두 잡는다.
    
- Exact 모드와 precision@k 측정을 통해 ANN 검색 품질을 수치화하고, `m`·`ef_construct` 파라미터로 정밀하게 조정할 수 있다.
    

이제 간단한 데모부터 실서비스용 뉴럴·하이브리드 검색 API, 그리고 성능 평가·튜닝까지 일련의 흐름을 모두 익혔다. 실제 프로젝트에 맞추어 데이터 전처리, 필터 인덱스, 멀티테넌시, 배치 업로드, 재랭킹 등을 조합하면 보다 견고한 벡터 기반 검색 시스템을 구축할 수 있을 것이다.