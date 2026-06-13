---
title: OpenSearch Approximate k-NN — 근사 벡터 검색 알고리즘과 설정 가이드
description: OpenSearch에서 대규모 벡터 데이터를 빠르게 검색하기 위한 Approximate k-NN(ANN) 기능을 정리한다.
  NMSLIB, Faiss, Lucene 기반 알고리즘의 차이와 HNSW/IVF 인덱스 설정 방법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- k-NN
- 벡터검색
- HNSW
- FAISS
- Search Engine
---


OpenSearch는 기본적으로 **정확한 k-NN 검색**을 지원하지만, 데이터 양이 많고 벡터의 차원이 높아질수록 성능 저하 문제가 발생합니다. 이 문제를 해결하기 위한 대안으로 **Approximate k-NN 검색** 기능이 제공된다.

Approximate k-NN 검색은 일부 정확성을 희생하는 대신, 검색 속도를 획기적으로 높이는 방식으로 **수십만 개 이상의 벡터 데이터를 다룰 때 특히 유용**하다.

## 1. Approximate k-NN이란?

- **정확한 k-NN**: 모든 벡터 간 거리 계산 → 정확하지만 느림
    
- **근사 k-NN (ANN)**: 인덱스 구조를 최적화하여 일부 정확도를 희생하고 속도 향상
    

OpenSearch는 다음 라이브러리 기반 ANN 알고리즘을 활용한다.

- **NMSLIB**
    
- **Faiss**
    
- **Lucene**


## 2. 벡터 인덱스 생성

먼저 벡터 인덱스를 생성할 때 `index.knn` 설정을 `true`로 지정해야 한다. 이는 벡터를 인덱싱할 때 네이티브 라이브러리 인덱스를 생성하겠다는 뜻이다.

```json
PUT my-knn-index-1
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  },
  "mappings": {
    "properties": {
      "my_vector1": {
        "type": "knn_vector",
        "dimension": 2,
        "space_type": "l2",
        "method": {
          "name": "hnsw",
          "engine": "faiss",
          "parameters": {
            "ef_construction": 128,
            "m": 24
          }
        }
      }
    }
  }
}
```

- `engine`: faiss, nmslib, lucene 중 선택
    
- `space_type`: 유사도 계산 방식 (예: `l2`, `innerproduct`)
    
- `dimension`: 벡터 차원 수

## 3. 데이터 색인 및 검색 예시

```json
POST _bulk
{ "index": { "_index": "my-knn-index-1", "_id": "1" } }
{ "my_vector1": [1.5, 2.5], "price": 12.2 }
...
```

```json
GET my-knn-index-1/_search
{
  "size": 2,
  "query": {
    "knn": {
      "my_vector1": {
        "vector": [2.0, 3.0],
        "k": 2
      }
    }
  }
}
```

- `k`: 유사 벡터 수
    
- `size`: 최종 반환할 결과 수 (샤드 수에 따라 곱해짐)

> Lucene, Faiss, NMSLIB 엔진별로 `k`와 `size` 해석 방식에 차이가 있음


## 4. 모델 기반 인덱스 구성 (Training 기반)

특정 알고리즘(예: IVF, PQ 등)을 사용할 경우 인덱싱 전에 모델 학습(Train API)이 필요하다.

### Step 1: 학습용 인덱스 생성 및 데이터 삽입

```json
PUT /train-index
{
  "mappings": {
    "properties": {
      "train-field": {
        "type": "knn_vector",
        "dimension": 4
      }
    }
  }
}
```

```json
POST _bulk
{ "index": { "_index": "train-index", "_id": "1" } }
{ "train-field": [1.5, 5.5, 4.5, 6.4] }
...
```

> `index.knn`은 설정하지 않아야 학습 전용으로 사용할 수 있음

### Step 2: Train API 호출

```json
POST /_plugins/_knn/models/my-model/_train
{
  "training_index": "train-index",
  "training_field": "train-field",
  "dimension": 4,
  "description": "My model description",
  "method": {
    "name": "ivf",
    "engine": "faiss",
    "parameters": {
      "encoder": {
        "name": "pq",
        "parameters": {
          "code_size": 2,
          "m": 2
        }
      }
    }
  }
}
```

학습이 완료되면 `state: created`로 변경된다.

```json
GET /_plugins/_knn/models/my-model?filter_path=state&pretty
```

### Step 3: 모델을 사용하는 인덱스 생성

```json
PUT /target-index
{
  "settings": {
    "index.knn": true
  },
  "mappings": {
    "properties": {
      "target-field": {
        "type": "knn_vector",
        "model_id": "my-model"
      }
    }
  }
}
```

이제 이 인덱스에 데이터를 삽입하면 모델 기반 인덱스가 자동으로 구성된다.

## 5. 고급 기능 및 주의 사항

- ANN 방식은 **정확도보다 속도와 확장성에 중점**
    
- 필터 조건은 **검색 후 결과에 적용**됨 (사전 필터링 불가)
    
- 벡터는 최대 **16,000차원까지 지원**
    
- 벡터 인덱스는 **네이티브 메모리**에 로딩되며 Warmup API로 사전 로딩 가능
    
- 검색 성능을 확인하려면 Stats API 활용

## 마무리

OpenSearch의 Approximate k-NN 검색 기능은 대용량 벡터 데이터를 빠르게 검색해야 하는 모든 상황에서 핵심 도구이다. 특히 **수십만 개 이상의 고차원 벡터 데이터**를 다루는 추천 시스템, 문서 유사도 검색, 이미지 검색 등에서 탁월한 성능을 발휘한다.