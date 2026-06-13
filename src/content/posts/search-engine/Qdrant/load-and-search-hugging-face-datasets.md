---
title: Hugging Face 데이터셋을 Qdrant에 로드하고 검색하기
description: Hugging Face에 공개된 사전 임베딩 데이터셋을 Qdrant에 로드하여 즉시 벡터 검색을 실습하는 방법을 정리한다.
  arxiv-titles 데이터셋 예시로 대규모 벡터 업로드와 검색 과정을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- HuggingFace
- 데이터셋
- 임베딩
- Search Engine
---


Hugging Face는 모델뿐 아니라 다양한 공개 데이터셋을 제공한다. Qdrant 팀 역시 **임베딩이 미리 계산된 데이터셋**을 업로드해 두었다. 이를 활용하면 임베딩 생성 과정을 생략하고 즉시 벡터 데이터베이스 실습을 시작할 수 있다.

#### 예시 데이터셋 ― `arxiv-titles-instructorxl-embeddings`

- **내용**: ArXiv 논문 _제목_만을 INSTRUCTOR-XL(768차원)로 임베딩
    
- **크기**: 약 225만 개 벡터, 16 GB 이상
    
- **페이로드**:
    
    ```json
    {
      "title": "Nash Social Welfare for Indivisible Items under ...",
      "DOI": "1612.05191"
    }
    ```


### 1. Hugging Face에서 데이터 불러오기

```python
from datasets import load_dataset

dataset = load_dataset("Qdrant/arxiv-titles-instructorxl-embeddings")
# → 디스크 전체 다운로드 (시간 소요)
```

##### 스트리밍으로 메모리 절약

```python
dataset = load_dataset(
    "Qdrant/arxiv-titles-instructorxl-embeddings",
    split="train",
    streaming=True,      # 다운로드 없이 스트림
)
```

### 2. Qdrant 컬렉션 생성

```python
from qdrant_client import QdrantClient, models

client = QdrantClient("http://localhost:6333")   # 필요 시 URL 변경

client.create_collection(
    collection_name="arxiv-titles-instructorxl-embeddings",
    vectors_config=models.VectorParams(
        size=768,
        distance=models.Distance.COSINE
    ),
)
```


### 3. 대용량 배치 업로드

대규모 데이터는 **배치**로 나누어 `upsert` 해야 효율적이다.

```python
from itertools import islice

def batched(iterable, n: int):
    iterator = iter(iterable)
    while (batch := list(islice(iterator, n))):
        yield batch

batch_size = 100

for batch in batched(dataset, batch_size):
    ids     = [row.pop("id")     for row in batch]   # id 분리
    vectors = [row.pop("vector") for row in batch]   # 벡터 분리

    client.upsert(
        collection_name="arxiv-titles-instructorxl-embeddings",
        points=models.Batch(
            ids=ids,
            vectors=vectors,
            payloads=batch,     # title·DOI 등 메타데이터
        ),
    )
```

- Python 3.12 이상이면 `itertools.batched` 를 바로 사용해도 된다.
    

업로드가 끝나면 **벡터 검색 즉시 가능**하다.


### 4. 간단한 검색 예시

```python
result = client.query_points(
    collection_name="arxiv-titles-instructorxl-embeddings",
    query=[…768차원 쿼리 벡터…],
    limit=5,
).points

for p in result:
    print(p.payload["title"], p.score)
```

#### 더 많은 실습용 데이터

Qdrant Hub·Hugging Face에 계속 추가 중이다. 필요한 데이터셋이 있다면 Discord 채널로 요청하면 된다.