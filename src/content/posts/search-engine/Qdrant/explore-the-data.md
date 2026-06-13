---
title: Qdrant 데이터 탐색 — 추천, Discovery, 그룹 검색 API
description: Qdrant의 벡터 검색 외 데이터 탐색 API를 정리한다. 긍정/부정 예시 기반 추천(Recommend), Discovery
  검색, 그룹화 결과 분석, 랜덤 샘플링 등 다양한 데이터 탐색 방법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 추천시스템
- Discovery
- API
- Search Engine
---


Qdrant는 벡터 검색 외에도 다양한 방식으로 데이터를 탐색할 수 있는 API를 제공한다. 

유사한 벡터를 찾는 것은 물론, 서로 가장 다른 벡터를 탐색하거나 그룹화된 결과를 분석하는 등 추천 시스템과 데이터 클렌징, 통계 기반 분석 등에 유용하게 활용할 수 있다.

## 1. 추천 API (Recommendation API)

Qdrant는 여러 개의 긍정(positive) 및 부정(negative) 예시를 바탕으로 유사한 결과를 찾는 **recommend** 쿼리를 제공한다. 

이 방식은 기존 포인트 ID를 이용하거나, 원시 벡터(raw vector)를 직접 입력하여 유사도를 계산할 수 있다.

```json
POST /collections/{collection_name}/points/query
{
  "query": {
    "recommend": {
      "positive": [100, 231],
      "negative": [718, [0.2, 0.3, 0.4, 0.5]],
      "strategy": "average_vector"
    }
  },
  "filter": {
    "must": [
      {
        "key": "city",
        "match": { "value": "London" }
      }
    ]
  }
}
```

### 추천 전략 종류

#### (1) average_vector (기본값)

- 긍정 벡터 평균에서 부정 벡터 평균을 뺀 후 다시 더한 벡터를 생성
    
- 성능은 일반 검색과 유사하며 빠르다
    
- 전략 수식
    
    `query = avg_positive + avg_positive - avg_negative`
    

#### (2) best_score

- 각 후보 벡터에 대해 각각의 긍정/부정 예시와 점수를 계산한 뒤, 최상의 점수를 기반으로 판단
    
- 부정 예시만 사용하여 가장 상이한(outlier) 벡터를 탐색할 수 있음
    
- 많은 예시를 제공할 경우 정확도는 높지만 성능이 선형적으로 감소함
    

#### (3) sum_scores

- 모든 예시 벡터에 대해 점수를 계산하고 이를 합산하여 최종 점수로 사용
    
- 다양한 피드백 기반 추천 시스템에 적합
    
- 긍정 및 부정 예시만으로도 작동 가능

### Named Vector 사용

다중 벡터를 사용하는 컬렉션에서는 `using` 파라미터를 통해 벡터 이름을 지정할 수 있다.

```json
"using": "image"
```


### 외부 컬렉션 벡터 참조

`lookup_from` 파라미터를 사용하여 다른 컬렉션의 벡터를 참조해 추천을 수행할 수 있다. 동일한 차원과 거리 측정 방식을 사용하는 경우에만 가능하다.

```json
"lookup_from": {
  "collection": "users",
  "vector": "profile_embedding"
}
```

### 배치 추천

여러 개의 추천 요청을 한 번에 처리할 수 있다. 각 요청은 필터, 벡터, 전략을 독립적으로 설정할 수 있다.

```json
POST /collections/{collection_name}/query/batch
{
  "searches": [
    {
      "query": { "recommend": { "positive": [100, 231], "negative": [718] } },
      "filter": { "must": [{ "key": "city", "match": { "value": "London" } }] },
      "limit": 10
    },
    ...
  ]
}
```


## 2. 디스커버리 API (Discovery API)

v1.7부터 지원되는 Discovery API는 검색 공간을 positive/negative 쌍(context)으로 나누고, 해당 context에 적합한 포인트를 탐색하는 기능이다.

### 디스커버리 검색

`target` 벡터를 기준으로, 얼마나 많은 긍정 영역에 속하고 부정 영역을 피하는지를 기반으로 포인트를 선택한다.

```json
"discover": {
  "target": [0.2, 0.1, 0.9, 0.7],
  "context": [
    { "positive": 100, "negative": 718 },
    { "positive": 200, "negative": 300 }
  ]
}
```

- 정확도 향상을 위해 `params.ef` 값을 64 이상으로 높이는 것이 권장된다
    
- ID로 지정한 포인트는 검색 결과에서 제외된다

### 컨텍스트 검색 (Context search)

target 없이 context만 제공하여 **부정 예시를 피하고 긍정 예시에 가까운 포인트**를 탐색하는 방식이다. triplet loss 기반 점수 계산을 사용한다.

```json
"query": {
  "context": [
    { "positive": 100, "negative": 718 },
    { "positive": 200, "negative": 300 }
  ]
}
```

- score가 0.0에 가까울수록 더 적합한 결과로 간주된다
    
- 다양한 위치의 결과를 얻을 수 있어 탐색에 적합하다


## 3. Distance Matrix API

v1.12.0부터 Qdrant는 벡터 간 거리를 샘플링 기반으로 계산할 수 있는 **distance matrix API**를 지원한다. 이를 통해 군집화, 시각화, 차원 축소 등 다양한 분석을 수행할 수 있다.

### (1) Pairwise 형식

두 포인트 간 거리 값을 쌍으로 반환한다.

```json
POST /collections/{collection_name}/points/search/matrix/pairs
{
  "sample": 10,
  "limit": 2,
  "filter": {
    "must": [
      { "key": "color", "match": { "value": "red" } }
    ]
  }
}
```

```json
"pairs": [
  { "a": 1, "b": 3, "score": 1.40 },
  { "a": 1, "b": 4, "score": 1.25 },
  ...
]
```

---

### (2) Offset 형식

희소 행렬 형태로 거리를 반환한다. 다른 분석 도구와의 연동에 적합하다.

```json
"offsets_row": [0, 0, 1, 1],
"offsets_col": [2, 3, 0, 7],
"scores": [...],
"ids": [1, 2, 3, 4, ...]
```

- `offsets_row`, `offsets_col`: 거리 값 위치 정보
    
- `scores`: 거리 점수
    
- `ids`: 각 포인트의 ID 목록

## 결론

Qdrant는 단순한 벡터 유사도 검색을 넘어서 다양한 데이터 탐색 도구를 제공한다. 추천 시스템을 위한 positive/negative 기반 검색, 컨텍스트 기반의 유연한 검색, 대규모 벡터 간 거리 분석 등은 데이터 품질 개선과 의미 기반 추천을 위한 강력한 수단이 된다.

이러한 고급 검색 기능들은 정밀한 벡터 기반 검색 시스템을 구축하거나 복잡한 탐색 문제를 해결해야 하는 경우에 특히 유용하다.