---
title: OpenSearch Exact k-NN Search — Scoring Script 기반 정확 벡터 검색
description: OpenSearch의 Scoring Script 기반 Exact k-NN 검색을 정리한다. 필터링 조건과 함께 정확한 벡터
  유사도를 계산하는 브루트포스 방식의 사용법과 적용 시나리오를 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- k-NN
- 벡터검색
- Scoring Script
- Painless
- Search Engine
---


대규모 벡터 기반 검색에서 대부분은 속도를 위해 **Approximate k-NN(근사 최근접 이웃)** 검색을 사용한다.

하지만 필터링이 필요하거나 더 높은 정확도가 요구되는 경우에는 OpenSearch의 **Scoring Script 기반 Exact k-NN 검색**을 활용할 수 있다.

## 1. 왜 Scoring Script 기반 k-NN을 사용할까?

- **필터링 조건과 함께 벡터 검색**이 필요한 경우
    
- **벡터 수가 적고 정확도가 중요한 경우**
    
- **기존 Approximate k-NN 구조에서는 필터를 사후(post) 적용**하지만, Scoring Script는 **검색 전 필터(pre-filter) 적용이 가능**
    

> 단점: **브루트포스 방식**이라 대규모 데이터셋에서는 속도가 느릴 수 있음

## 2. 인덱스 생성 및 데이터 삽입

### 인덱스 생성

```json
PUT my-knn-index-1
{
  "mappings": {
    "properties": {
      "my_vector1": {
        "type": "knn_vector",
        "dimension": 2
      },
      "my_vector2": {
        "type": "knn_vector",
        "dimension": 4
      }
    }
  }
}
```

> `index.knn` 설정은 생략 가능. 이는 Approximate 방식 사용 안 할 경우에 유리 (속도, 메모리 측면)

### 데이터 삽입

```json
POST _bulk
{ "index": { "_index": "my-knn-index-1", "_id": "1" } }
{ "my_vector1": [1.5, 2.5], "price": 12.2 }
...
{ "index": { "_index": "my-knn-index-1", "_id": "9" } }
{ "my_vector2": [1.5, 5.5, 4.5, 6.4], "price": 8.9 }
```


## 3. 정확한 k-NN 검색 실행

```json
GET my-knn-index-1/_search
{
  "size": 4,
  "query": {
    "script_score": {
      "query": {
        "match_all": {}
      },
      "script": {
        "lang": "knn",
        "source": "knn_score",
        "params": {
          "field": "my_vector2",
          "query_value": [2.0, 3.0, 5.0, 6.0],
          "space_type": "cosinesimil"
        }
      }
    }
  }
}
```

- `lang`: 반드시 `knn` 사용
    
- `source`: `"knn_score"`
    
- `field`: 벡터 필드명
    
- `query_value`: 쿼리 벡터
    
- `space_type`: 거리 함수 (`l2`, `cosinesimil`, `hammingbit` 등)


## 4. Pre-filter 적용 예시

Scoring Script는 **검색 전에 조건 필터링**을 걸 수 있다는 점이 큰 장점이다.

### 인덱스 생성

```json
PUT my-knn-index-2
{
  "mappings": {
    "properties": {
      "my_vector": { "type": "knn_vector", "dimension": 2 },
      "color": { "type": "keyword" }
    }
  }
}
```

### 문서 삽입

```json
POST _bulk
{ "index": { "_index": "my-knn-index-2", "_id": "1" } }
{ "my_vector": [1, 1], "color": "RED" }
{ "index": { "_index": "my-knn-index-2", "_id": "4" } }
{ "my_vector": [10, 10], "color": "BLUE" }
```

### Pre-filter + 벡터 검색

```json
GET my-knn-index-2/_search
{
  "size": 2,
  "query": {
    "script_score": {
      "query": {
        "bool": {
          "filter": {
            "term": { "color": "BLUE" }
          }
        }
      },
      "script": {
        "lang": "knn",
        "source": "knn_score",
        "params": {
          "field": "my_vector",
          "query_value": [9.9, 9.9],
          "space_type": "l2"
        }
      }
    }
  }
}
```


## 5. Binary 데이터에 대한 Hamming Distance 검색

Scoring Script는 **Binary 또는 Long 타입 필드**에 대해 **Hamming Distance** 기반 벡터 검색도 지원한다.

### 인덱스 생성

```json
PUT my-index
{
  "mappings": {
    "properties": {
      "my_binary": {
        "type": "binary",
        "doc_values": true
      },
      "color": {
        "type": "keyword"
      }
    }
  }
}
```

### Base64 인코딩된 데이터 삽입

```json
POST _bulk
{ "index": { "_index": "my-index", "_id": "1" } }
{ "my_binary": "SGVsbG8gV29ybGQh", "color": "RED" }
...
```

### 검색 (Hamming distance 기반)

```json
GET my-index/_search
{
  "size": 2,
  "query": {
    "script_score": {
      "query": {
        "bool": {
          "filter": {
            "term": { "color": "BLUE" }
          }
        }
      },
      "script": {
        "lang": "knn",
        "source": "knn_score",
        "params": {
          "field": "my_binary",
          "query_value": "U29tZXRoaW5nIEltIGxvb2tpbmcgZm9y",
          "space_type": "hammingbit"
        }
      }
    }
  }
}
```

> `query_value`는 base64 문자열 (또는 long 정수)


## 마무리

OpenSearch의 Scoring Script 기반 k-NN 검색은 다음과 같은 상황에서 강력한 도구가 된다.

- **필터를 먼저 적용한 후 벡터 검색이 필요한 경우**
    
- **정확한 유사도 계산이 필수인 환경**
    
- **Binary 데이터에 대한 벡터 유사도 계산이 필요한 경우**
    

단, 대규모 데이터셋에는 적합하지 않으며 **Approximate k-NN 방식과 함께 하이브리드로 사용하는 것이 바람직**하다.