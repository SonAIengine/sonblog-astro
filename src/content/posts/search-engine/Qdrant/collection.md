---
title: Qdrant Collection — 컬렉션 생성, 설정, 고급 기능 가이드
description: Qdrant의 핵심 개념인 컬렉션(Collection)을 정리한다. 거리 측정 방식(Cosine, Euclid, Dot),
  벡터 차원 설정, 샤딩, 레플리카, Write Ahead Log 등 컬렉션 설정과 고급 기능을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 컬렉션
- 샤딩
- 거리측정
- Search Engine
---



Qdrant는 고성능 벡터 검색 엔진이며, 다양한 벡터 기반 검색 기능을 제공한다. 이 글에서는 Qdrant의 핵심 개 중 하나인 컬렉션(Collection)에 대해 설명하고, 설정 방법과 고급 기능까지 정리한다.


## 컬렉션(Collection)이란 무엇인가

Qdrant에서 컬렉션은 벡터(Point)와 그에 따른 **Payload**의 논리적 집합이다. 컬렉션 내부의 모든 벡터는 동일한 차원(dimensionality)과 동일한 거리 측정 방식(metric)을 사용해야 하며, 검색은 컬렉션 단위로 수행된다.

### 지원 거리 측정 방식

- Dot Product (내적)
    
- Cosine Similarity (코사인 유사도)
    
- Euclidean Distance (유클리디안 거리)
    
- Manhattan Distance (맨해튼 거리)
    

Cosine 방식은 내부적으로 정규화된 벡터에 대한 Dot Product로 구현되며, 업로드 시 벡터는 자동으로 정규화된다.


## 컬렉션 생성 예시

```http
PUT /collections/:collection_name
{
  "vectors": {
    "size": 300,
    "distance": "Cosine"
  }
}
```

### 선택 가능한 추가 설정

|설정 키|설명|
|---|---|
|`hnsw_config`|HNSW 인덱스 구조 설정|
|`wal_config`|Write-Ahead Log 관련 설정|
|`optimizers_config`|인덱스 최적화 설정|
|`shard_number`|샤드 개수|
|`on_disk_payload`|Payload를 디스크에만 저장할지 여부|
|`quantization_config`|벡터 양자화 설정|
|`strict_mode_config`|Strict 모드 설정|


## 멀티테넌시 구성 방법

### 단일 컬렉션 기반 멀티테넌시

대부분의 경우에는 하나의 컬렉션에서 **payload 기반 분리** 방식으로 멀티테넌시를 구성하는 것이 가장 효율적이다. 이 방법은 사용자 간의 논리적 구분이 가능하며, 시스템 자원을 절약할 수 있다.

### 다중 컬렉션 사용이 적합한 경우

사용자 수가 적고, 사용자 간 **완전한 성능 또는 데이터 격리**가 필요할 경우에는 여러 개의 컬렉션을 생성하는 것이 적합하다. 단, 이 방식은 자원 사용량이 증가할 수 있고, 각 컬렉션 간 성능 간섭을 방지해야 한다.

---

## 기존 컬렉션으로부터 새 컬렉션 생성

```http
PUT /collections/new_collection
{
  "vectors": {
    "size": 300,
    "distance": "Cosine"
  },
  "init_from": {
    "collection": "existing_collection"
  }
}
```

`init_from` 기능은 실험 또는 테스트 목적에는 유용하나, 성능 민감 환경에서는 예기치 않은 부하를 유발할 수 있으므로 주의가 필요하다.


## Named Vector를 사용한 다중 벡터 구성

하나의 포인트에 서로 다른 종류의 벡터를 저장하고, 각각의 이름과 설정을 별도로 지정할 수 있다.

```http
PUT /collections/multivector_collection
{
  "vectors": {
    "image": { "size": 4, "distance": "Dot" },
    "text": { "size": 8, "distance": "Cosine" }
  }
}
```

각 벡터는 고유 이름을 가져야 하며, 독립적으로 인덱싱 및 최적화 설정이 가능하다.


## RAM 또는 디스크 기반 벡터 저장

기본적으로 벡터는 RAM에 저장되어 빠른 검색이 가능하다. 그러나 `on_disk` 옵션을 활성화하면 메모리맵 기반으로 디스크에 저장할 수 있다.

```http
PATCH /collections/my_collection
{
  "vectors": {
    "": { "on_disk": true }
  }
}
```

Named Vector를 사용하는 경우에는 벡터 이름을 명시해야 한다.


## 정수형 벡터 저장 (uint8)

```http
PUT /collections/compact_collection
{
  "vectors": {
    "size": 1024,
    "distance": "Cosine",
    "datatype": "uint8"
  }
}
```

uint8 형식은 메모리를 절약하고 검색 속도를 향상시킬 수 있다. 다만, 일부 정밀도 손실이 있을 수 있다.


## Sparse Vector 저장

희소 벡터는 각 차원에 해당하는 값만 저장되는 구조이며, 주로 텍스트 기반 검색에 사용된다. 이름이 반드시 필요하며, 거리 측정 방식은 Dot으로 고정된다.

```http
PUT /collections/sparse_collection
{
  "sparse_vectors": {
    "text": {}
  }
}
```


## 컬렉션 상태 확인 및 삭제

- 컬렉션 존재 여부 확인: `GET /collections/{collection_name}/exists`
    
- 컬렉션 정보 조회: `GET /collections/{collection_name}`
    
- 컬렉션 삭제: `DELETE /collections/{collection_name}`
    

컬렉션의 상태는 다음과 같이 나타난다.

|상태|설명|
|---|---|
|green|최적화 완료|
|yellow|최적화 중|
|grey|최적화 대기 중 (업데이트 필요)|
|red|오류 발생|


## 컬렉션 Alias 사용

Alias는 컬렉션에 대한 별칭을 의미한다. 운영 환경에서는 버전 전환 시 유용하게 사용할 수 있다.

```http
POST /collections/aliases
{
  "actions": [
    {
      "create_alias": {
        "collection_name": "v1_collection",
        "alias_name": "prod_collection"
      }
    }
  ]
}
```

기존 alias를 다른 컬렉션으로 교체할 경우에는 원자적 처리로 `delete_alias` → `create_alias`를 함께 수행해야 한다.


## 벡터/포인트 수 확인

- `points_count`: 전체 포인트 수
    
- `vectors_count`: 전체 벡터 수
    
- `indexed_vectors_count`: 인덱싱된 벡터 수 (HNSW 등)
    

이 값들은 내부 최적화 상태에 따라 변동되며, 정확한 수치를 위해서는 count API를 사용하는 것이 바람직하다.


## 결론

Qdrant의 컬렉션은 단순한 벡터 저장소를 넘어서, 다양한 구성 옵션과 운영 기능을 제공한다. 다중 벡터 구성, 멀티테넌시, 디스크 저장, 양자화 및 alias 기능은 실무 환경에서 유용하게 활용될 수 있다. 컬렉션의 구조와 설정을 잘 이해하고 활용한다면, Qdrant를 통해 고성능 벡터 검색 시스템을 안정적으로 운영할 수 있다.