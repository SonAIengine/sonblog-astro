---
title: Qdrant Hybrid Queries — 다중 벡터 검색과 Fusion 전략
description: Qdrant의 Query API를 활용한 하이브리드 검색 전략을 정리한다. Named Vector 결합, Dense/Sparse
  퓨전, prefetch 다단계 검색, 점수 보정과 비즈니스 로직 반영 방법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 하이브리드검색
- Fusion
- Query API
- Search Engine
---


Qdrant는 복수의 벡터 표현(named vectors)을 가진 포인트를 효율적으로 검색하고 결합할 수 있도록 다양한 검색 전략을 지원한다. 

단일 쿼리를 넘어서 다단계 검색, 유사도 기반 순위 조정, 비즈니스 로직을 반영한 점수 보정까지 가능한 Query API는 강력하고 유연한 벡터 검색 인터페이스를 제공한다.

## 1. Hybrid Search (하이브리드 검색)

### 개요

다양한 임베딩 표현을 동시에 사용하는 경우, 각 표현으로 수행한 검색 결과를 하나로 융합하는 것이 하이브리드 검색의 핵심이다. 예를 들어, dense vector와 sparse vector를 각각 검색한 뒤 이를 결합할 수 있다.

### 융합 방식

- **rrf (Reciprocal Rank Fusion)**  
    결과 순위 기반으로 점수를 융합하며, 여러 쿼리에서 높은 순위를 차지한 포인트에 가중치를 부여한다.
    
- **dbsf (Distribution-Based Score Fusion)**  
    각 쿼리 결과의 점수를 정규화한 뒤 같은 포인트에 대해 점수를 합산한다. v1.11.0부터 지원된다.

### 예시: dense + sparse 벡터 융합

```json
POST /collections/{collection_name}/points/query
{
  "prefetch": [
    {
      "query": {
        "indices": [1, 42],
        "values": [0.22, 0.8]
      },
      "using": "sparse",
      "limit": 20
    },
    {
      "query": [0.01, 0.45, 0.67, ...],
      "using": "dense",
      "limit": 20
    }
  ],
  "query": { "fusion": "rrf" },
  "limit": 10
}
```


## 2. Multi-Stage Query (다단계 검색)

### 개요

정확도가 높은 고차원 벡터를 사용하는 것은 비용이 크기 때문에, 빠른 검색용 벡터로 후보군을 추출한 뒤, 고정밀 벡터로 재정렬하는 방식이 유효하다.

### 구성 예시

- **1단계:** 빠른 벡터로 후보 추출
    
- **2단계:** 정확한 벡터로 재정렬
    

```json
POST /collections/{collection_name}/points/query
{
  "prefetch": {
    "query": [1, 23, 45, 67],
    "using": "mrl_byte",
    "limit": 1000
  },
  "query": [0.01, 0.299, 0.45, 0.67, ...],
  "using": "full",
  "limit": 10
}
```

또는 다단계로 중첩된 prefetch도 가능하다.

```json
"prefetch": {
  "prefetch": {
    "query": [1, 23, 45, 67],
    "using": "mrl_byte",
    "limit": 1000
  },
  "query": [0.01, 0.45, 0.67, ...],
  "using": "full",
  "limit": 100
}
```


## 3. Score Boosting (점수 보정)

### 개요

기계 학습 기반의 벡터 유사도만으로는 도메인 특성이나 비즈니스 우선순위를 반영하기 어려운 경우가 많다. Qdrant는 벡터 기반 점수에 조건 기반 점수를 합산하거나 가중치를 부여할 수 있는 **formula 기반 score boosting**을 제공한다.

### 예시: 콘텐츠 유형에 따라 점수 가중치 조정

```json
"query": {
  "formula": {
    "sum": [
      "$score",
      {
        "mult": [0.5, { "key": "tag", "match": { "any": ["h1", "h2", "h3"] } }]
      },
      {
        "mult": [0.25, { "key": "tag", "match": { "any": ["p", "li"] } }]
      }
    ]
  }
}
```

### 예시: 사용자 위치 기반 점수 보정

```json
"query": {
  "formula": {
    "sum": [
      "$score",
      {
        "gauss_decay": {
          "x": {
            "geo_distance": {
              "origin": { "lat": 52.504043, "lon": 13.393236 },
              "to": "geo.location"
            }
          },
          "scale": 5000
        }
      }
    ]
  },
  "defaults": {
    "geo.location": { "lat": 48.137154, "lon": 11.576124 }
  }
}
```

### 지원 연산자 요약

|연산자|설명|
|---|---|
|`$score`|prefetch에서 계산된 유사도 점수|
|`key`|payload 키 참조|
|`sum`, `mult`, `div`, `pow` 등|수치 연산|
|`geo_distance`|두 지리 좌표 간 거리 계산|
|`gauss_decay`, `lin_decay`, `exp_decay`|거리 기반 점수 감소 함수|
|`datetime`, `datetime key`|날짜 기반 정렬 또는 점수화|


## 4. Grouping (결과 그룹화)

같은 항목에 대해 다수의 포인트가 존재할 경우, 이를 그룹화하여 중복을 줄이고 대표 결과만 보여줄 수 있다.

```json
POST /collections/{collection_name}/points/query/groups
{
  "query": [1.1],
  "group_by": "document_id",
  "limit": 4,
  "group_size": 2
}
```

- `group_by`: 그룹의 기준 필드
    
- `limit`: 그룹 수 제한
    
- `group_size`: 각 그룹에서 반환할 최대 포인트 수


## 결론

Qdrant는 복수 벡터 기반 검색 환경에서 단순한 유사도 비교를 넘어서 **검색 융합, 다단계 최적화, 조건 기반 점수 조정, 그룹화** 등 고도화된 검색 로직을 구축할 수 있도록 풍부한 기능을 제공한다. 이를 통해 검색 품질 향상, 성능 최적화, 비즈니스 목적에 부합하는 정렬 및 추천이 가능해진다.

이러한 고급 기능은 특히 하이브리드 검색 시스템, MRL 기반 검색, 사용자 맞춤형 추천 시스템, 복합 조건 검색에서 큰 효과를 발휘할 수 있다.