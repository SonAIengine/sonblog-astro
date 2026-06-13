---
title: OpenSearch Radial Search — 유사도 임계값 기반 반경 벡터 검색
description: OpenSearch의 Radial Search(반경 검색) 기능을 정리한다. Top-k 방식 대신 거리 또는 유사도 점수 임계값을
  기준으로 벡터를 검색하는 방법과 max_distance, min_score 파라미터 사용법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- Radial Search
- 유사도
- k-NN
- Search Engine
---


OpenSearch는 벡터 검색에서 일반적으로 사용하는 **Top-k 검색** 방식 외에도, **특정 거리나 유사도 임계값 기준으로 검색하는 Radial Search(반경 검색)** 기능을 지원한다,

이는 **공간적 근접성**이나 **유사도 임계값 기반 필터링**이 필요한 경우에 매우 유용하다.


## 1. Radial Search란?

Radial Search는 쿼리 벡터를 중심으로 **지정된 반경 이내** 또는 **유사도 점수가 일정 기준 이상인 문서**를 반환하는 벡터 검색 방식이다.

### 주요 파라미터

| 파라미터           | 설명                                    |
| -------------- | ------------------------------------- |
| `max_distance` | 쿼리 벡터와의 거리(l2 등) 기준으로 거리 이내에 있는 벡터 검색 |
| `min_score`    | 유사도 점수가 특정 기준 이상인 벡터 검색               |
| `k`            | Top-k 검색 (선택적으로 사용, 위 두 값 중 하나만 필요)   |

> 이 중 하나만 지정하면 동작함 (`k`, `max_distance`, `min_score` 중 택1)


## 2. 지원 범위

| 엔진         | 필터 지원 | Nested 지원 | 검색 방식       |
| ---------- | ----- | --------- | ----------- |
| **Lucene** | ✅     | ❌         | Approximate |
| **Faiss**  | ✅     | ✅         | Approximate |

> 즉, **필터 조건**, **Nested Field**, **공간 기반 거리 조건**과 함께 활용 가능


## 3. 인덱스 생성

```json
PUT knn-index-test
{
  "settings": {
    "index.knn": true
  },
  "mappings": {
    "properties": {
      "my_vector": {
        "type": "knn_vector",
        "dimension": 2,
        "space_type": "l2",
        "method": {
          "name": "hnsw",
          "engine": "faiss",
          "parameters": {
            "ef_construction": 100,
            "m": 16,
            "ef_search": 100
          }
        }
      }
    }
  }
}
```


## 4. 데이터 색인

```json
PUT _bulk?refresh=true
{"index": {"_index": "knn-index-test", "_id": "1"}}
{"my_vector": [7.0, 8.2], "price": 4.4}
{"index": {"_index": "knn-index-test", "_id": "2"}}
{"my_vector": [7.1, 7.4], "price": 14.2}
{"index": {"_index": "knn-index-test", "_id": "3"}}
{"my_vector": [7.3, 8.3], "price": 19.1}
```


## 5. 예시: max_distance 기반 검색

```json
GET knn-index-test/_search
{
  "query": {
    "knn": {
      "my_vector": {
        "vector": [7.1, 8.3],
        "max_distance": 2
      }
    }
  }
}
```

- **설명**: 쿼리 벡터와의 **l2 거리 제곱이 2 이하인 벡터**만 검색


## 6. 예시: max_distance + 필터 결합

```json
GET knn-index-test/_search
{
  "query": {
    "knn": {
      "my_vector": {
        "vector": [7.1, 8.3],
        "max_distance": 2,
        "filter": {
          "range": {
            "price": {
              "gte": 1,
              "lte": 5
            }
          }
        
        }
      }
    }
  }
}
```

- **설명**: 거리 조건 + `price` 필드 범위 필터 적용


## 7. 예시: min_score 기반 검색

```json
GET knn-index-test/_search
{
  "query": {
    "knn": {
      "my_vector": {
        "vector": [7.1, 8.3],
        "min_score": 0.95
      }
    }
  }
}
```

- **설명**: **유사도 점수가 0.95 이상**인 벡터만 검색  
    (주로 cosine similarity 등 유사도 기반 공간에서 활용)


## 8. 예시: min_score + 필터 결합

```json
GET knn-index-test/_search
{
  "query": {
    "knn": {
      "my_vector": {
        "vector": [7.1, 8.3],
        "min_score": 0.95,
        "filter": {
          "range": {
            "price": {
              "gte": 1,
              "lte": 5
            }
          }
        }
      }
    }
  }
}
```

- **결과**: 유사도 점수 조건 + 가격 필터를 모두 만족하는 문서 반환

## 9. 실전 팁

- `max_distance`는 **거리 기반 필터링**이 필요할 때 유용
    
- `min_score`는 **유사도 기반 추천/검색**에서 매우 직관적
    
- `filter`를 함께 사용하면 **속도 개선** 및 **정밀한 검색 제어** 가능
    
- `nested_field`, `hybrid`, `binary`, `hamming` 검색과 함께 응용 가능


## 마무리

Radial Search는 단순한 Top-k 검색을 넘어서 **벡터 공간의 범위 기반 검색**을 가능하게 한다.

거리 제한 또는 유사도 임계값을 기준으로 문서를 선별하는 데 탁월한 방식이며, **추천 시스템, 위치 기반 검색, 정밀 필터링 검색** 등에 활용할 수 있다.
