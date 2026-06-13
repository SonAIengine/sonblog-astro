---
title: OpenSearch Star-tree Index — 사전 집계로 Aggregation 성능 극대화
description: OpenSearch 2.18에서 실험적으로 도입된 Star-tree Index를 정리한다. 인덱싱 시점에 다차원 집계를 미리
  계산해 저장함으로써 쿼리 시 Aggregation 성능을 극대화하는 구조와 설정 방법을 다룬다.
pubDatetime: 2025-06-30
tags:
- OpenSearch
- 검색엔진
- Aggregation
- Star-tree Index
- 성능최적화
- 집계
- Search Engine
---


집계(Aggregation)는 데이터 규모가 커질수록 집계 성능은 급격히 저하되며, 이로 인해 쿼리 지연(latency)과 리소스 소비가 증가하는 문제가 있습니다. 이를 해결하기 위해 OpenSearch 2.18부터 **신규 기능인 Star-tree Index**가 실험적으로 도입되었습니다.

## Star-tree Index란?
Star-tree Index는 **미리 집계된(Aggregated) 값을 다양한 차원 조합에 따라 저장하는 인덱스 구조**입니다. 기존에는 쿼리 시점에 집계를 수행했지만, Star-tree는 인덱싱 시점에 각 조합별 집계를 미리 계산해 저장하므로, 검색 쿼리 시 빠르게 응답할 수 있습니다.

## 주요 특징

- **멀티 필드 집계 최적화**: 여러 필드의 조합에 대한 집계도 효율적으로 처리
    
- **실시간 동작**: 인덱싱 중 segment flush/refresh 시마다 star-tree 구조 생성
    
- **쿼리 문법 변경 없음**: 기존 쿼리 그대로 사용 가능하며, 자동 최적화 적용
    
- **페이징 및 디스크 I/O 효율 향상**: 적은 리프 탐색으로 빠른 응답 가능


## Star-tree Index 구조

Star-tree는 트리 형태로 구성되며, 다음과 같은 구성요소를 포함합니다:

### Dimension 노드 (ordered_dimensions)

- 예: `status`, `port`, `method`
    
- 트리의 경로를 구성하는 필드들
    

### Metric 노드 (metrics)

- 예: `sum(size)`, `avg(latency)`
    
- 리프 노드에 저장되는 사전 계산된 값들
    

### Star 노드 (`*`)

- 특정 차원에 대해 모든 값을 집계한 노드
    
- 쿼리 조건이 없는 차원을 건너뛸 수 있도록 최적화
    

### Leaf 노드

- 지정된 조합에 대한 최종 metric 값 저장
    
- `max_leaf_docs` 값으로 문서 수 제한 가능


## 설정 예시
```
PUT /logs
{
  "settings": {
    "index.composite_index": true,
    "index.append_only.enabled": true
  },
  "mappings": {
    "composite": {
      "request_aggs": {
        "type": "star_tree",
        "config": {
          "ordered_dimensions": [
            { "name": "status" },
            { "name": "port" },
            { "name": "method" }
          ],
          "metrics": [
            { "name": "size", "stats": ["sum"] },
            { "name": "latency", "stats": ["avg"] }
          ],
          "date_dimension": {
            "name": "@timestamp",
            "calendar_intervals": ["month", "day"]
          }
        }
      }
    },
    "properties": {
      "status": { "type": "integer" },
      "port": { "type": "integer" },
      "method": { "type": "keyword" },
      "size": { "type": "integer" },
      "latency": { "type": "scaled_float", "scaling_factor": 10 }
    }
  }
}

```

## 쿼리 예시 및 최적화 방식

쿼리는 기존 OpenSearch 쿼리와 동일하며, star-tree가 자동 적용됩니다.

### 1. 단일 조건 집
```
{
  "query": { "term": { "status": 500 } },
  "aggs": { "sum_size": { "sum": { "field": "size" } } }
}
```

→ `status=500` 노드에 미리 저장된 값에서 `sum(size)`를 즉시 반환


### 2. 날짜 기반 집계

```
{
  "size": 0,
  "query": { "range": { "status": { "gte": "200", "lte": "400" } } },
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "month"
      },
      "aggs": {
        "sum_size": {
          "sum": {
            "field": "size"
          }
        }
      }
    }
  }
}
```

→ 월 단위로 `status` 필터를 적용한 `sum(size)`를 빠르게 반환


### 3. Terms 집계
```
{
  "aggs": {
    "users": {
      "terms": {
        "field": "user_id"
      }
    }
  }
}
```

→ `user_id`가 dimension에 포함된 경우 star-tree로 최적화


### 4. Range 집계
```
{
  "aggs": {
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 100 },
          { "from": 100, "to": 500 },
          { "from": 500 }
        ]
      },
      "aggs": {
        "total_quantity": {
          "sum": {
            "field": "quantity"
          }
        }
      }
    }
  }
}
```

→ 범위 기반 버킷 집계도 star-tree로 처리 가능

## 주의사항 및 제한

| 항목                               | 제한 내용                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| ❌ 문서 수정/삭제                       | 지원하지 않음 (append-only 인덱스 필요)                                  |
| ❌ _id와 같은 고유 필드                  | dimension으로 사용 금지 (고카디널리티로 인한 성능 저하)                          |
| ❌ array 필드                       | 지원하지 않음                                                       |
| ❌ must_not, minimum_should_match | Boolean 쿼리에서 지원되지 않음                                          |
| ✅ 지원 쿼리                          | term, terms, range, match_all, 일부 bool 쿼리                     |
| ✅ 지원 집계                          | sum, avg, min, max, value_count, date_histogram, terms, range |
