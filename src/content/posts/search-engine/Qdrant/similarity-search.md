---
title: Qdrant Similarity Search — 벡터 유사도 검색 API 완벽 가이드
description: Qdrant의 유사도 검색(Similarity Search) API를 정리한다. k-NN 기반 벡터 검색, Query API
  통합 인터페이스, 스코어 부스팅, 필터 결합 등 고속 유사도 검색 방법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 유사도검색
- k-NN
- Query API
- Search Engine
---


Qdrant에서의 유사도 검색(Similarity Search)은 벡터 유사도 기반 검색의 핵심 기능이다. 

신경망 기반 임베딩 모델이 입력 데이터를 벡터로 변환한 뒤, 해당 벡터 간의 유사도를 비교하여 가장 가까운 객체를 찾아낸다. 

Qdrant는 이 과정을 고속으로 처리하기 위한 다양한 API와 최적화 기법을 제공한다.


## 유사도 검색의 개요

벡터 기반 유사도 검색은 k-최근접 이웃(k-NN) 방식에 기반하며, 실제 유사한 객체(텍스트, 이미지, 오디오 등)는 벡터 공간상에서도 서로 가까운 위치에 있게 된다. Qdrant는 이러한 유사도 기반 검색을 단일 API(Query API)로 통합하여 제공한다.


## Query API

`/points/query` 엔드포인트는 Qdrant에서 다양한 검색 기능을 수행하는 핵심 인터페이스이다. 주요 지원 기능은 다음과 같다.

- **Nearest Neighbors Search**: 일반적인 벡터 유사도 검색 (k-NN)
    
- **Search by ID**: 기존에 저장된 포인트의 벡터를 기준으로 검색
    
- **Recommendations**: 긍정/부정 예시를 활용한 추천
    
- **Discovery Search**: 컨텍스트 기반 1회성 학습 검색
    
- **Scroll**: 모든 포인트를 조건 기반으로 페이징 조회
    
- **Grouping**: 특정 필드를 기준으로 결과를 그룹화
    
- **Hybrid Search**: 다양한 검색 조건을 결합한 하이브리드 검색
    
- **Random Sampling**: 임의 샘플링
    
- **Multi-Stage Search**: 대규모 임베딩을 위한 검색 최적화


## 기본 유사도 검색

```json
POST /collections/{collection_name}/points/query
{
  "query": [0.2, 0.1, 0.9, 0.7]
}
```


## ID 기반 검색

```json
POST /collections/{collection_name}/points/query
{
  "query": "43cf51e2-8777-4f52-bc74-c2cbde0c8b04"
}
```

해당 ID에 저장된 벡터를 기준으로 유사도 검색을 수행한다.  
`using` 파라미터를 지정하면 Named Vector 사용이 가능하다.


## 검색 메트릭(Metric)

Qdrant는 다음과 같은 유사도 메트릭을 지원한다.

- **Dot Product**
    
- **Cosine Similarity** (기본값)
    
- **Euclidean Distance**
    
- **Manhattan Distance** (v1.7부터 지원)
    

Cosine 메트릭은 벡터를 정규화한 후 Dot Product 방식으로 계산되며, 이는 SIMD 최적화를 통해 빠르게 수행된다.


## 필터링을 포함한 검색 예시

```json
POST /collections/{collection_name}/points/query
{
  "query": [0.2, 0.1, 0.9, 0.79],
  "filter": {
    "must": [
      { "key": "city", "match": { "value": "London" } }
    ]
  },
  "params": {
    "hnsw_ef": 128,
    "exact": false
  },
  "limit": 3
}
```

- `limit`: 결과 수 제한
    
- `hnsw_ef`: HNSW 탐색 깊이
    
- `exact`: true로 설정 시 전체 스캔을 수행하여 정확한 결과를 반환

## Named Vector 검색

```json
POST /collections/{collection_name}/points/query
{
  "query": [0.2, 0.1, 0.9, 0.7],
  "using": "image",
  "limit": 3
}
```

여러 개의 Named Vector가 존재할 경우 `using`으로 명시적으로 지정해야 한다.

## Sparse Vector 검색

```json
POST /collections/{collection_name}/points/query
{
  "query": {
    "indices": [1, 3, 5, 7],
    "values": [0.1, 0.2, 0.3, 0.4]
  },
  "using": "text"
}
```

희소 벡터 검색은 항상 정확한 매칭을 수행하며, Dot Product만을 사용한다. 유사도 계산 속도는 쿼리 벡터의 비제로 값 개수에 비례한다.


## 유사도 점수 필터링

```json
{
  "score_threshold": 0.75
}
```

검색 결과에서 유사도 점수가 기준 이하인 결과는 제외된다. 메트릭에 따라 의미는 달라지며, 예를 들어 유클리드 거리의 경우 값이 클수록 멀다고 판단하여 제거된다.


## 벡터 및 페이로드 반환

기본적으로 검색 결과는 ID와 점수만을 반환한다. 벡터 및 페이로드도 함께 가져오려면 다음과 같이 설정한다.

```json
{
  "with_vectors": true,
  "with_payload": true
}
```

특정 페이로드만 포함하거나 제외할 수도 있다.

```json
"with_payload": ["city", "town"]
```

또는

```json
"with_payload": {
  "exclude": ["city"]
}
```


## 배치 검색

다수의 검색 쿼리를 한 번에 수행할 수 있다.

```json
POST /collections/{collection_name}/points/query/batch
{
  "searches": [
    { "query": [...], "filter": {...}, "limit": 3 },
    { "query": [...], "filter": {...}, "limit": 3 }
  ]
}
```

필터가 동일한 경우 내부적으로 공유 최적화를 통해 처리 속도를 향상시킬 수 있다.


## 검색 결과 페이지네이션

```json
{
  "limit": 10,
  "offset": 100
}
```

해당 설정은 11페이지(101번째)부터 10개 결과를 반환한다. 다만 HNSW 기반 검색의 특성상 큰 offset은 성능 저하를 초래할 수 있다.


## 그룹 기반 검색

`document_id` 등 특정 필드를 기준으로 결과를 그룹화할 수 있다.

```json
POST /collections/{collection_name}/points/query/groups
{
  "query": [1.1],
  "group_by": "document_id",
  "limit": 4,
  "group_size": 2
}
```

- `limit`: 최대 그룹 수
    
- `group_size`: 각 그룹 내 포인트 수
    

배열 필드를 기준으로 그룹화할 경우, 해당 포인트는 여러 그룹에 중복 포함될 수 있다.


## 그룹화 + 룩업

중복 페이로드를 줄이기 위해, 문서 수준 메타데이터를 별도 컬렉션에 저장하고 그룹별로 `lookup`을 통해 참조할 수 있다.

```json
"with_lookup": {
  "collection": "documents",
  "with_payload": ["title", "text"],
  "with_vectors": false
}
```

결과는 그룹 내부에 `lookup` 필드로 포함된다.


## 랜덤 샘플링

v1.11.0부터는 무작위 포인트 샘플링이 가능하다.

```json
POST /collections/{collection_name}/points/query
{
  "query": { "sample": "random" }
}
```

디버깅, 테스트, 탐색 초기화 등에 유용하게 사용할 수 있다.


## 쿼리 계획(Query Planning)

Qdrant는 검색 시 쿼리 조건과 인덱스 상태에 따라 자동으로 실행 전략을 결정한다. 이 과정은 **Query Planner**에 의해 수행된다. 주요 원칙은 다음과 같다.

- 세그먼트(segment) 단위로 독립적으로 계획 수립
    
- 포인트 수가 적으면 전체 스캔 사용
    
- 필터 조건의 cardinality(결과 수 예측값)에 따라 적절한 인덱스 선택
    
- 가능한 경우 Payload Index 우선 사용
    

이 전략은 설정 파일을 통해 조정 가능하며, 컬렉션별로 개별 설정도 가능하다.


## 결론

Qdrant의 Similarity Search는 단순한 k-NN 검색을 넘어서, 필터링, 정렬, 그룹화, 배치 처리 등 다양한 기능을 포함하고 있다. 

정확성과 속도 간의 균형을 고려하여 필요한 검색 기능을 조합할 수 있으며, 벡터 기반 검색 시스템을 설계할 때 Qdrant의 Query API는 매우 강력한 도구가 될 수 있다.