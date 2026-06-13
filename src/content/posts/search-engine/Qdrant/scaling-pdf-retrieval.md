---
title: Qdrant로 대규모 PDF 검색 확장하기 — ColPali 멀티벡터 최적화
description: Qdrant에서 ColPali/ColQwen2 비전 LLM의 멀티벡터로 대규모 PDF를 검색하는 방법을 정리한다. Mean
  Pooling으로 벡터 수를 축소하고 2단계 검색(HNSW + rescore)으로 성능을 확보하는 전략을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- PDF
- ColPali
- RAG
- Search Engine
---


대규모 PDF 검색은 RAG·에이전트형 워크플로우에서 핵심 요소이다. 

ColPali·ColQwen2와 같은 비전 LLM(VLLM)은 **OCR·룰 기반 파싱 없이** PDF 페이지 이미지를 직접 임베딩하여 최신 벤치마크(예: ViDoRe)에서 뛰어난 성능을 보인다. 

그러나 VLLM은 한 페이지당 수백 ~ 천여 개의 **멀티벡터**를 생성하므로, 그대로 HNSW 인덱싱을 수행하면 **RAM 사용량 폭증·인덱스 구축 지연·검색 지연** 문제가 발생한다.

본 튜토리얼은 다음 전략으로 이러한 병목을 해소하는 방법을 설명한다.

1. **1단계 검색** ― 행·열 기준 **Mean Pooling** 으로 벡터 수를 수십 개로 축소하여 HNSW 인덱스 구축
    
2. **2단계 재랭킹** ― 원본 멀티벡터를 사용해 상위 후보(예: 100개)를 ColPali·ColQwen2의 Late Interaction(MAX SIM)으로 정밀 재정렬


### 1. 사전 준비

```bash
pip install colpali_engine>=0.3.1         # ColPali / ColQwen2
pip install qdrant-client[fastembed]>=1.12 # Qdrant + 임베딩
```

```python
from colpali_engine.models import ColPali, ColPaliProcessor
from qdrant_client import QdrantClient, models

client = QdrantClient(url="<Qdrant_Cluster_URL>", api_key="<API_KEY>")
model      = ColPali.from_pretrained("vidore/colpali-v1.3",
                                     torch_dtype="bfloat16",
                                     device_map="cuda:0").eval()
processor  = ColPaliProcessor.from_pretrained("vidore/colpali-v1.3")
```

_ColQwen2_도 동일한 방법으로 로드할 수 있다.


### 2. 컬렉션 설계

|벡터 이름|용도|크기|HNSW|multivector|
|---|---|---|---|---|
|`original`|원본 멀티벡터 → 재랭킹|128|**비활성(m=0)**|MAX_SIM|
|`mean_pooling_rows`|행별 평균|128|활성|MAX_SIM|
|`mean_pooling_columns`|열별 평균|128|활성|MAX_SIM|

```python
client.create_collection(
    "pdf-pages",
    vectors_config = {
        "original": models.VectorParams(
            size=128, distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM),
            hnsw_config=models.HnswConfigDiff(m=0)            # 인덱싱 OFF
        ),
        "mean_pooling_rows": models.VectorParams(
            size=128, distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM)
        ),
        "mean_pooling_columns": models.VectorParams(
            size=128, distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM)
        )
    }
)
```

### 3. 데이터셋 준비

```python
from datasets import load_dataset
dataset = load_dataset("davanstrien/ufo-ColPali", split="train")
```


### 4. 임베딩 및 Mean Pooling

```python
import torch, uuid, tqdm

def embed_page(image):
    proc = processor.process_images([image])
    vecs = model(**proc)[0]               # (1030, 128) ColPali 예시
    mask = proc.input_ids[0] == processor.image_token_id
    img_tokens = vecs[mask]
    x, y = processor.get_n_patches(image.size, model.patch_size)  # (32, 32)
    img_tokens = img_tokens.view(x, y, -1)

    # 행·열 평균
    rows    = img_tokens.mean(dim=1)                # (x, 128)
    columns = img_tokens.mean(dim=0)                # (y, 128)

    # 특수 토큰 6개 유지
    specials = vecs[~mask]
    rows    = torch.cat([rows, specials])           # (x+6, 128)
    columns = torch.cat([columns, specials])        # (y+6, 128)

    return vecs, rows, columns
```


### 5. 업로드

```python
points=[]
for i, row in enumerate(tqdm.tqdm(dataset[:1000])):  # 예시: 1,000페이지
    original, rows, cols = embed_page(row["image"])

    points.append(
        models.PointStruct(
            id=uuid.uuid4().hex,
            vector={
                "original": original.cpu().numpy(),
                "mean_pooling_rows": rows.cpu().numpy(),
                "mean_pooling_columns": cols.cpu().numpy()
            },
            payload={"index": i}
        )
    )

client.upload_points("pdf-pages", points=points, batch_size=8)
```


### 6. 검색 파이프라인

```python
query = "Lee Harvey Oswald's involvement in the JFK assassination"
q_vec  = model(**processor.process_queries([query]).to(model.device))[0]

prefetched = client.query_points(
    "pdf-pages",
    query=q_vec,
    prefetch=[
        models.Prefetch(query=q_vec, using="mean_pooling_rows",    limit=100),
        models.Prefetch(query=q_vec, using="mean_pooling_columns", limit=100)
    ],
    using="original",            # 재랭킹 단계
    limit=10,
    with_payload=True
)
```


### 7. 성능 효과

- **ColPali 원본**: 페이지당 1,030 벡터 × `ef_construct=100` → 삽입당 최소 103,000 비교
    
- **Mean Pooling 32×32**: 페이지당 ≈32 벡터 → 비교량을 30배 이상 감소
    
- 실험 결과
    
    - **인덱싱 시간**: 10배 이상 단축
        
    - **1단계 Recall**: 원본 대비 손실 미미
        
    - **재랭킹**: 최종 정밀도 유지

### 8. 결론 및 권장 사항

- **멀티벡터 압축 → 1단계 검색**, **원본 멀티벡터 → 재랭킹** 전략이 필수적이다.
    
- 단순 양자화는 비교 횟수를 줄이지 못하므로 처리 속도 병목을 해결하지 못한다.
    
- Qdrant의 `multivector_config`, `hnsw_config(m=0)` 옵션을 적극 활용하여 **RAM·CPU 자원**을 절약하라.
    
- ColPali·ColQwen2와 같은 VLLM 기반 PDF RAG 파이프라인을 구축할 때, 본 튜토리얼의 설계를 적용하면 **대량 문서**도 실용적인 시간 안에 인덱싱·검색할 수 있다.