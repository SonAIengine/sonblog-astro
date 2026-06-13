---
title: OpenSearch 벡터 검색 성능 최적화 가이드
description: OpenSearch에서 벡터 검색 성능을 향상시키는 전략을 정리한다. 세그먼트 수 축소, 벡터 메모리 적재, 쿼리 결과 캐싱,
  source 필드 제외 등 쿼리 지연을 줄이기 위한 설정과 방법을 다룬다.
pubDatetime: 2025-07-04
tags:
- OpenSearch
- 검색엔진
- 성능최적화
- 벡터검색
- 캐싱
- 세그먼트
- Search Engine
---


OpenSearch에서 벡터 기반 검색을 빠르게 처리하기 위해서는 쿼리 처리 비용을 줄이고, 캐시를 적극 활용하며, 네트워크 전송량을 최소화하는 것이 중요합니다. 다음은 주요 성능 향상 전략이다.


## 1. 세그먼트 수 줄이기 (Reduce Segment Count)

- Lucene은 **모든 세그먼트에 대해 개별 검색 후 결과를 병합**하여 상위 `size` 개 결과를 반환
    
- 세그먼트 수가 많을수록 검색 시간이 늘어남
    
- 최적 성능은 "샤드 당 1개 세그먼트"일 때 달성
    
- 세그먼트 수 제어 방법
    
    - `refresh_interval`을 늘리거나
        
    - 색인 중 `refresh_interval: -1`로 비활성화

```json
PUT /<index_name>/_settings
{
  "index": {
    "refresh_interval": "-1"
  }
}
```


## 2. 인덱스 예열 (Warm up the Index)

- 벡터 색인 시 생성된 **native library index**는 처음 검색 시 메모리에 로딩됨
    
- **첫 쿼리는 수 초**, 이후 쿼리는 밀리초 수준으로 단축됨 (캐시 때문)
    
- OpenSearch 3.1부터는 **memory-optimized search mode**가 도입되어 필요한 바이트만 로딩 가능
    

### Warmup API 사용

```http
GET /_plugins/_knn/warmup/index1,index2,index3?pretty
```

- 모든 primary/replica shard의 벡터 인덱스를 **메모리 캐시에 사전 로딩**
    
- 색인 추가, refresh, merge 이후에는 **다시 실행 필요**

## 3. Stored Fields 비활용 (불필요한 데이터 읽기 최소화)

### 문서 내용이 필요 없는 경우

- `_source: false` 설정으로 **ID, score만 반환**
    
- 가장 빠른 검색 방식
    

```json
GET /my-index/_search
{
  "_source": false,
  "query": {
    "knn": {
      "vector_field": {
        "vector": [0.1, 0.2, 0.3],
        "k": 10
      }
    }
  }
}
```


## 4. 벡터 필드만 제외 (Vector 제외, 다른 필드는 유지)

- 전체 문서 내용은 필요하지만, 벡터 필드는 응답에 포함하지 않아도 될 경우 유용
    
- 네트워크 트래픽 감소 효과 있음

```json
GET /my-index/_search
{
  "_source": {
    "excludes": [
      "vector_field"
    ]
  },
  "query": {
    "knn": {
      "vector_field": {
        "vector": [0.1, 0.2, 0.3],
        "k": 10
      }
    }
  }
}
```


## 요약: 성능 향상 체크리스트

|항목|설명|
|---|---|
|세그먼트 수 최소화|색인 중 refresh 비활성화로 세그먼트 병합 유도|
|Warmup API 사용|첫 쿼리 지연 방지, 메모리 캐시 사전 로딩|
|`_source: false`|ID와 점수만 필요한 경우|
|`_source.excludes`|벡터 필드만 제외하고 나머지 정보 유지|
