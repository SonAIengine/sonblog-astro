---
title: OpenSearch Nested Field로 다중 벡터 검색 구현하기
description: OpenSearch에서 nested 필드를 활용해 하나의 문서에 여러 벡터를 저장하고 검색하는 방법을 정리한다. 문단, 이미지,
  설명 등 구성 요소별 벡터를 knn_vector로 인덱싱하는 매핑 설계와 검색 쿼리를 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- Nested Field
- k-NN
- 인덱스설계
- Search Engine
---


벡터 기반 검색 시스템을 구축할 때, 하나의 문서가 여러 개의 구성 요소(예: 문단, 이미지, 설명 등)로 이뤄져 있다면 **각 요소마다 벡터를 생성하여 문서 내에 함께 저장**하고 싶을 수 있다.

OpenSearch는 이를 위해 **nested 필드 기반 벡터 검색** 기능을 제공한다.

## 1. Nested Field란?

- 하나의 문서 내에 배열 형태로 객체를 포함할 수 있는 구조
    
- 각 객체 안에 `knn_vector`를 포함하여 **다수의 벡터를 한 문서에 저장 가능**
    
- 검색 시 각 문서의 **가장 유사한 벡터만 기준으로 스코어 결정**

## 2. 인덱스 생성 예시

```json
PUT my-knn-index-1
{
  "settings": {
    "index": {
      "knn": true
    }
  },
  "mappings": {
    "properties": {
      "nested_field": {
        "type": "nested",
        "properties": {
          "my_vector": {
            "type": "knn_vector",
            "dimension": 3,
            "space_type": "l2",
            "method": {
              "name": "hnsw",
              "engine": "lucene",
              "parameters": {
                "ef_construction": 100,
                "m": 16
              }
            }
          },
          "color": {
            "type": "text",
            "index": false
          }
        }
      }
    }
  }
}
```


## 3. 문서 색인 예시

```json
PUT _bulk?refresh=true
{ "index": { "_index": "my-knn-index-1", "_id": "1" } }
{
  "nested_field": [
    { "my_vector": [1,1,1], "color": "blue" },
    { "my_vector": [2,2,2], "color": "yellow" },
    { "my_vector": [3,3,3], "color": "white" }
  ]
}
{ "index": { "_index": "my-knn-index-1", "_id": "2" } }
{
  "nested_field": [
    { "my_vector": [10,10,10], "color": "red" },
    { "my_vector": [20,20,20], "color": "green" },
    { "my_vector": [30,30,30], "color": "black" }
  ]
}
```


## 4. 기본 벡터 검색 쿼리

```json
GET my-knn-index-1/_search
{
  "query": {
    "nested": {
      "path": "nested_field",
      "query": {
        "knn": {
          "nested_field.my_vector": {
            "vector": [1, 1, 1],
            "k": 2
          }
        }
      }
    }
  }
}
```

> 이 쿼리는 벡터 유사도가 높은 상위 2개 벡터가 포함된 문서를 반환  
> → 벡터가 모두 문서 1에 있더라도 **서로 다른 문서**가 포함될 수 있음


## 5. Inner Hits로 매칭된 Nested 객체 확인

기본적으로 어떤 하위 객체가 매칭되었는지 알 수 없다.
`inner_hits`를 통해 해당 정보를 확인할 수 있다.

```json
GET my-knn-index-1/_search
{
  "_source": false,
  "query": {
    "nested": {
      "path": "nested_field",
      "query": {
        "knn": {
          "nested_field.my_vector": {
            "vector": [1,1,1],
            "k": 2
          }
        }
      },
      "inner_hits": {
        "_source": false,
        "fields": ["nested_field.color"]
      }
    }
  }
}
```


## 6. 모든 Nested 벡터 점수 확인 (확장 검색)

기본 설정에서는 문서 내에서 가장 높은 벡터 점수만 사용한다.
모든 벡터 스코어를 반영하려면 `expand_nested_docs: true`를 설정하고,  
문서 점수로 어떤 값을 사용할지 `score_mode`로 지정합니다.

```json
"score_mode": "max" // 또는 "avg", "sum", "none"
```

```json
"knn": {
  "nested_field.my_vector": {
    "vector": [1,1,1],
    "k": 2,
    "expand_nested_docs": true
  }
}
```


## 7. Top-level 또는 Nested 필드 필터링

`knn` 쿼리에 `filter`를 추가하여 문서 단위로 필터링할 수 있다.

```json
GET my-knn-index-1/_search
{
  "query": {
    "nested": {
      "path": "nested_field",
      "query": {
        "knn": {
          "nested_field.my_vector": {
            "vector": [1,1,1],
            "k": 3,
            "filter": {
              "term": {
                "parking": true
              }
            }
          }
        }
      }
    }
  }
}
```

> 위 예시에서는 `parking: true` 조건을 만족하는 문서만 벡터 유사도로 검색


## 요약

|기능|설명|
|---|---|
|**nested_field 벡터**|여러 벡터를 하나의 문서에 저장 가능|
|**inner_hits**|어떤 하위 객체가 매칭되었는지 확인|
|**expand_nested_docs**|모든 벡터 점수 고려 가능|
|**filter**|벡터 검색 시 조건 필터 가능 (top-level 및 nested)|
