---
title: OpenSearch Vector Search 가이드 — Raw Vector와 Neural 검색 비교
description: OpenSearch의 벡터 검색 방식을 정리한다. knn 쿼리로 직접 벡터를 입력하는 Raw Vector 검색과, neural
  쿼리로 텍스트/이미지를 자동 임베딩하는 방식의 차이와 사용법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- Neural Search
- k-NN
- 임베딩
- Search Engine
---


벡터 검색은 텍스트, 이미지, 제품 설명 등 복잡한 데이터를 벡터(숫자 배열)로 변환하여 의미 기반 검색을 가능하게 하는 최신 검색 방식이다. 

## 벡터 검색 방식 비교

| 기능                | 쿼리 타입    | 입력 형식          | 임베딩 모델 필요 여부 | 주요 사용 사례      |
| ----------------- | -------- | -------------- | ------------ | ------------- |
| **Raw Vector 검색** | `knn`    | 벡터 배열 (vector) | 필요 없음        | 기존 벡터를 활용한 검색 |
| **자동 생성 임베딩 검색**  | `neural` | 텍스트 또는 이미지     | 필요           | AI 기반 의미 검색   |

## 1. Raw Vector 검색

벡터가 이미 생성되어 있고, 이를 직접 활용하여 검색하고자 할 경우에는 `knn` 쿼리를 사용한다. 
벡터 필드에 배열을 직접 입력하고 `k` 값을 지정하여 유사한 문서 N개를 검색한다.

```json
GET /my-raw-vector-index/_search
{
  "query": {
    "knn": {
      "my_vector": {
        "vector": [0.1, 0.2, 0.3],
        "k": 2
      }
    }
  }
}
```

- `my_vector`: 색인된 문서의 벡터 필드
    
- `vector`: 쿼리 벡터 배열 (직접 입력)
    
- `k`: 반환할 문서 개수

> 적합한 경우: 외부에서 임베딩한 벡터 데이터를 직접 인덱싱하여 사용하는 경우


## 2. 자동 생성 임베딩 검색 (Neural Search)

OpenSearch는 AI 검색을 위해 쿼리 입력값(텍스트, 이미지 등)을 임베딩으로 자동 변환해주는 기능을 제공한다. 이때 사용하는 쿼리 타입은 `neural` 이다.

```json
GET /my-ai-search-index/_search
{
  "_source": {
    "excludes": [
      "output_embedding"
    ]
  },
  "query": {
    "neural": {
      "output_embedding": {
        "query_text": "What is AI search?",
        "model_id": "mBGzipQB2gmRjlv_dOoB",
        "k": 2
      }
    }
  }
}
```

- `query_text`: 검색어(자연어 등)
    
- `model_id`: 텍스트 임베딩 모델 ID (Ingest pipeline에서 사용한 것과 동일해야 함)
    
- `output_embedding`: 임베딩 결과가 저장된 벡터 필드
    
- `_source.excludes`: 검색 결과에서 임베딩 벡터를 제외하고 싶을 경우

> 적합한 경우: 자연어 질의에 대한 **의미 기반 검색**이 필요한 경우  
> 예: “이 제품과 유사한 다른 제품 보여줘”, “AI 검색이 뭐야?” 등의 질문


## 3. 희소 벡터(Sparse Vector) 검색

OpenSearch는 희소 벡터(sparse vector)를 활용한 검색도 지원합니다. 이는 단어 빈도 기반의 BoW(Bag of Words), TF-IDF, BM25 등 전통적인 방식과 유사한 희소 표현을 벡터화하여 사용하는 구조입니다.

> 참고: 희소 벡터 검색은 Neural Sparse Search 기능을 통해 사용할 수 있으며, 별도 모델과 설정이 필요합니다.


## 마무리

OpenSearch의 벡터 검색 기능은 단순한 키워드 매칭을 넘어서 **의미와 맥락을 이해하는 검색**을 가능하게 한다. 필요에 따라 raw vector 검색 또는 AI 기반 neural search를 선택하여 사용할 수 있으며, **하이브리드 검색**과 결합하면 더욱 강력한 검색 엔진을 구현할 수 있다.