---
title: Qdrant Points — 벡터 데이터 CRUD와 Payload 필터링 가이드
description: Qdrant의 핵심 데이터 단위인 포인트(Point)를 정리한다. 벡터와 페이로드를 포함하는 레코드의 생성, 조회, 수정,
  삭제(CRUD) 연산과 배치 업서트, 스크롤 API 사용법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Points
- CRUD
- Payload
- Search Engine
---



Qdrant에서 가장 핵심적인 데이터 단위는 포인트(Point)이다. 포인트는 벡터와 페이로드(payload)를 함께 포함하는 하나의 레코드이며, Qdrant에서의 **유사도 검색**, **필터링 기반 검색**, **데이터 업데이트**, **삭제 및 조회** 등의 모든 연산은 이 포인트를 중심으로 이루어진다.  

하나의 포인트는 반드시 **하나 이상의 벡터**를 포함해야 하며, 이 벡터는 머신러닝 모델이나 임베딩 알고리즘에 의해 생성된 고차원 수치 배열이다. 벡터는 주로 의미적 유사성을 비교하는 데 사용되며, 사용자는 유사한 벡터를 가진 포인트를 빠르게 찾아낼 수 있다.

페이로드는 선택적으로 제공되는 추가 정보로, 일반적인 JSON 형태의 키-값 쌍으로 구성된다. 
예를 들어 `"color": "red"` 또는 `"category": "electronics"`와 같은 형태이며, 
검색 시 필터 조건으로 활용하거나, 조회 시 메타데이터로 함께 응답받을 수 있다.

Qdrant의 포인트는 단순한 데이터 구조를 넘어서, 벡터 기반 검색 시스템에서의 유연성과 확장성을 동시에 제공하는 중심 단위라 할 수 있다.

## 포인트의 구조

포인트는 다음과 같은 JSON 형태로 표현된다.

```json
{
    "id": 129,
    "vector": [0.1, 0.2, 0.3, 0.4],
    "payload": {"color": "red"}
}
```

각 포인트는 벡터를 포함하고 있으며, 선택적으로 key-value 형태의 payload를 추가할 수 있다. 벡터는 컬렉션 내에서의 유사도 기반 검색에 사용된다.



## 포인트 식별자(ID)

Qdrant는 포인트 식별자로 **정수형 ID (64비트 unsigned integer)** 또는 **UUID**를 지원한다. UUID는 다음과 같은 형식이 허용된다.

- 간단한 UUID: `936DA01F9ABD4d9d80C702AF85C822A8`
    
- 하이픈 포함: `550e8400-e29b-41d4-a716-446655440000`
    
- URN 형식: `urn:uuid:F9168C5E-CEB2-4faa-B6BF-329BF39FA1E4`
    

UUID와 정수는 자유롭게 선택할 수 있으며, 아래와 같이 사용할 수 있다.

```json
{
  "points": [
    {
      "id": "5c56c793-69f3-4fbf-87e6-c4bf54c28c26",
      "vector": [0.9, 0.1, 0.1],
      "payload": {"color": "red"}
    }
  ]
}
```


## 지원 벡터 유형

Qdrant는 다양한 유형의 벡터를 포인트에 연결할 수 있다.

|벡터 유형|설명|
|---|---|
|Dense Vector|대부분의 임베딩 모델이 생성하는 일반적인 벡터|
|Sparse Vector|대부분의 값이 0인 희소 벡터. 텍스트 처리나 협업 필터링에 유용|
|MultiVector|ColBERT 같은 모델에서 생성된 고정 너비, 가변 높이 행렬|

Qdrant는 여러 벡터를 하나의 포인트에 붙일 수 있으며, 이를 **Named Vector**라 한다.


## 포인트 업로드 방식

Qdrant는 성능을 위해 배치 업로드(Batch Insert)를 지원한다. 한 번의 요청으로 여러 포인트를 등록할 수 있다.

### 1. Column-Oriented 방식

```json
{
  "batch": {
    "ids": [1, 2, 3],
    "payloads": [
      {"color": "red"},
      {"color": "green"},
      {"color": "blue"}
    ],
    "vectors": [
      [0.9, 0.1, 0.1],
      [0.1, 0.9, 0.1],
      [0.1, 0.1, 0.9]
    ]
  }
}
```

### 2. Record-Oriented 방식

```json
{
  "points": [
    {
      "id": 1,
      "vector": [0.9, 0.1, 0.1],
      "payload": {"color": "red"}
    },
    {
      "id": 2,
      "vector": [0.1, 0.9, 0.1],
      "payload": {"color": "green"}
    }
  ]
}
```

모든 업로드 작업은 **idempotent**하다. 즉, 같은 포인트 ID를 가진 데이터를 여러 번 업로드해도 결과는 동일하며, 이전 값이 덮어쓰여진다.


## Named Vector 예시

```json
{
  "points": [
    {
      "id": 1,
      "vector": {
        "image": [0.9, 0.1, 0.1, 0.2],
        "text": [0.4, 0.7, 0.1, 0.8, 0.1, 0.1, 0.9, 0.2]
      }
    }
  ]
}
```

포인트 업로드 시 특정 vector만 지정하면, 지정하지 않은 벡터는 삭제된다. 기존 벡터를 유지한 채 특정 벡터만 변경하려면 **update vectors API**를 사용해야 한다.


## Sparse Vector 표현 방식

희소 벡터는 대부분의 값이 0이므로, (index, value) 쌍의 배열로 표현된다.

```json
{
  "indices": [6, 7],
  "values": [1.0, 2.0]
}
```

벡터는 반드시 Named Vector 형식으로 업로드해야 하며, index는 정렬되지 않아도 되지만 내부적으로 자동 정렬된다.


## 벡터 수정 API

특정 벡터만 업데이트하고 나머지는 유지하려면 다음과 같이 한다.

```json
PUT /collections/{collection_name}/points/vectors
{
  "points": [
    {
      "id": 1,
      "vector": {
        "image": [0.1, 0.2, 0.3, 0.4]
      }
    }
  ]
}
```


## 벡터 삭제 API

특정 벡터만 제거하고 나머지는 그대로 유지하려면 다음과 같이 한다.

```json
POST /collections/{collection_name}/points/vectors/delete
{
  "points": [1],
  "vectors": ["text"]
}
```


## 포인트 삭제

```json
POST /collections/{collection_name}/points/delete
{
  "points": [1, 2, 3]
}
```

필터를 통해 조건에 맞는 포인트만 삭제할 수도 있다.

```json
{
  "filter": {
    "must": [
      {
        "key": "color",
        "match": { "value": "red" }
      }
    ]
  }
}
```


## 포인트 조회

ID 목록으로 조회:

```json
POST /collections/{collection_name}/points
{
  "ids": [1, 2]
}
```

단일 포인트 조회:

```http
GET /collections/{collection_name}/points/1
```


## 포인트 Scroll (페이징)

```json
POST /collections/{collection_name}/points/scroll
{
  "filter": {
    "must": [
      {
        "key": "color",
        "match": { "value": "red" }
      }
    ]
  },
  "limit": 1,
  "with_payload": true,
  "with_vector": false
}
```

`next_page_offset` 필드를 통해 다음 페이지를 탐색할 수 있다. 만약 null이라면 마지막 페이지임을 의미한다.


## 페이로드 정렬 기반 조회

payload 안의 필드를 기준으로 정렬하려면 `order_by`를 사용한다. 예를 들어, timestamp 필드를 기준으로 정렬하려면 다음과 같이 한다.

```json
{
  "limit": 15,
  "order_by": {
    "key": "timestamp",
    "direction": "desc",
    "start_from": 123
  }
}
```

정렬을 사용하면 `next_page_offset`은 제공되지 않으며, pagination은 수동으로 처리해야 한다.


## 포인트 수 카운트

조건에 맞는 포인트 수를 조회하려면 다음과 같이 한다.

```json
POST /collections/{collection_name}/points/count
{
  "filter": {
    "must": [
      {
        "key": "color",
        "match": { "value": "red" }
      }
    ]
  },
  "exact": true
}
```


## 배치 업데이트

여러 종류의 작업을 한 번에 처리하려면 `batch` API를 사용할 수 있다.

```json
POST /collections/{collection_name}/points/batch
{
  "operations": [
    {
      "upsert": {
        "points": [
          {
            "id": 1,
            "vector": [1.0, 2.0, 3.0, 4.0],
            "payload": {}
          }
        ]
      }
    },
    {
      "delete_vectors": {
        "points": [1],
        "vector": [""]
      }
    },
    {
      "overwrite_payload": {
        "payload": {
          "test_payload": "1"
        },
        "points": [1]
      }
    },
    {
      "delete": {
        "points": [1]
      }
    }
  ]
}
```


## 비동기 처리

요청 시 `?wait=false`를 붙이면 응답이 빠르지만, 데이터 반영까지 시간이 걸릴 수 있다. 반면, `?wait=true`를 사용하면 업데이트가 완료된 후 응답을 받는다.


## 마무리

Qdrant의 포인트(Point)는 벡터 검색과 데이터 조작의 기본 단위로서 중요한 역할을 한다. 

UUID 또는 정수 ID를 사용하여 유연하게 접근할 수 있으며, Dense/Sparse/MultiVector 등 다양한 벡터 유형을 지원한다. 또한 페이로드 기반 필터링, 정렬, 대용량 배치 업로드 및 수정까지 광범위한 기능을 제공하므로, 검색 기반 시스템을 구축할 때 강력한 도구로 활용할 수 있다.