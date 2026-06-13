---
title: Qdrant Payload — 벡터에 메타데이터 저장하고 필터링하기
description: Qdrant의 Payload 기능을 정리한다. 벡터에 JSON 형태의 부가 정보를 저장하고, 텍스트/숫자/날짜/위치 등 다양한
  타입을 활용한 필터링과 패싯 검색 구현 방법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Payload
- 메타데이터
- 필터링
- Search Engine
---


Qdrant는 벡터 기반 검색 시스템이지만, 단순한 벡터 유사도 비교를 넘어 추가적인 속성 정보(Payload)를 함께 저장하고 검색할 수 있다는 점에서 매우 강력하다. 

이 기능을 통해 사용자 정의 필터링, 메타데이터 기반 조건 검색, 페이싱 및 패싯 기반 탐색이 가능하다.


## Payload란 무엇인가

Payload는 벡터에 연결된 부가 정보로, JSON 형식으로 저장된다. 텍스트, 숫자, 날짜, 위치 정보 등 다양한 형태의 데이터를 담을 수 있으며, 각 포인트에 유의미한 속성을 부여함으로써 검색 결과의 유용성과 정밀도를 높일 수 있다.

다음은 예시이다.

```json
{
  "name": "jacket",
  "colors": ["red", "blue"],
  "count": 10,
  "price": 11.99,
  "locations": [{ "lon": 52.5200, "lat": 13.4050 }],
  "reviews": [
    { "user": "alice", "score": 4 },
    { "user": "bob", "score": 5 }
  ]
}
```


## 지원하는 Payload 타입

Qdrant는 다양한 데이터 타입을 지원하며, 검색 시 필터링 조건으로도 사용할 수 있다. 데이터 타입에 따라 검색 가능한 조건이 다르므로 적절한 타입 사용이 중요하다.

| 타입       | 설명                                   |
| -------- | ------------------------------------ |
| Integer  | 64비트 정수, 단일 혹은 배열 형태로 저장 가능          |
| Float    | 64비트 실수, 가격, 점수 등의 정밀한 수치 표현         |
| Bool     | true 또는 false                        |
| Keyword  | 문자열 데이터, 정렬 및 매칭 조건에 적합              |
| Geo      | 위도(lat), 경도(lon)로 구성된 좌표값            |
| Datetime | RFC 3339 포맷의 날짜/시간                   |
| UUID     | 고유 식별자 형태의 문자열. 1.11.0 이상에서 별도 타입 지원 |

### 배열 처리 방식

배열은 내부 값 중 **하나라도 조건에 부합**하면 필터 조건을 충족한 것으로 간주된다.


## Payload 삽입 예시

```json
PUT /collections/my_collection/points
{
  "points": [
    {
      "id": 1,
      "vector": [0.05, 0.61, 0.76, 0.74],
      "payload": { "city": "Berlin", "price": 1.99 }
    },
    {
      "id": 2,
      "vector": [0.19, 0.81, 0.75, 0.11],
      "payload": { "city": ["Berlin", "London"], "price": 1.99 }
    }
  ]
}
```


## Payload 업데이트 방식

### 1. Set Payload

기존 페이로드는 유지한 채 특정 필드만 설정하거나 덮어쓴다.

```json
POST /collections/my_collection/points/payload
{
  "payload": {
    "brand": "Nike",
    "stock": 100
  },
  "points": [1, 2]
}
```

또는 필터를 사용해 특정 조건을 만족하는 포인트에 적용할 수 있다.

```json
{
  "payload": { "brand": "Nike" },
  "filter": {
    "must": [{ "key": "color", "match": { "value": "red" } }]
  }
}
```

### 2. 키 지정 업데이트 (Nested 구조 지원)

```json
POST /collections/my_collection/points/payload
{
  "payload": { "nested_property": "qux" },
  "key": "property1",
  "points": [1]
}
```

이 방식은 `property1` 내부의 `nested_property` 값만 변경한다.


### 3. Overwrite Payload

기존 payload 전체를 완전히 대체한다.

```json
PUT /collections/my_collection/points/payload
{
  "payload": {
    "name": "jacket",
    "price": 19.99
  },
  "points": [1, 2]
}
```


### 4. Clear Payload

포인트에서 모든 payload 필드를 제거한다.

```json
POST /collections/my_collection/points/payload/clear
{
  "points": [1, 2]
}
```

### 5. Delete Payload Keys

특정 키만 제거하고 나머지 필드는 유지한다.

```json
POST /collections/my_collection/points/payload/delete
{
  "keys": ["price", "color"],
  "points": [1, 2]
}
```

필터를 활용한 제거도 가능하다.


## Payload 인덱싱

효율적인 검색을 위해 payload 필드에 인덱스를 생성할 수 있다. 인덱스는 검색 속도를 크게 향상시키며, 특히 결과 범위를 빠르게 줄일 수 있는 필드에 효과적이다.

예시

```json
PUT /collections/my_collection/index
{
  "field_name": "brand",
  "field_schema": "keyword"
}
```

페이로드 인덱스는 컬렉션 메타 정보 조회 시 확인할 수 있다.

```json
"payload_schema": {
  "brand": {
    "data_type": "keyword"
  },
  "price": {
    "data_type": "float"
  }
}
```


## Facet Count (패싯 카운트)

1.12.0부터 Qdrant는 특정 필드에 대해 값별 개수 통계(facet)를 제공한다. 이는 SQL의 `GROUP BY`와 유사하며, 필터링 또는 분포 시각화에 활용된다.

```json
POST /collections/my_collection/facet
{
  "key": "size",
  "filter": {
    "must": [{ "key": "color", "match": { "value": "red" } }]
  }
}
```

결과 예시

```json
"hits": [
  { "value": "L", "count": 19 },
  { "value": "M", "count": 10 },
  { "value": "S", "count": 5 }
]
```

기본적으로 `limit`은 10이며, `exact: true`로 설정하면 정확한 수치를 반환한다.


## 마무리

Qdrant의 Payload 기능은 벡터 기반 검색에 구조화된 조건을 더할 수 있게 해주며, 이를 통해 단순 유사도 기반 검색을 넘어선 고차원적 필터링과 분석이 가능하다.  
정형 데이터와 비정형 데이터가 함께 존재하는 상황에서도 Qdrant는 유연하고 강력한 데이터 표현 및 필터링 능력을 제공한다.

Payload를 잘 설계하고 인덱싱을 적절히 설정하면 검색 품질과 응답 속도를 모두 향상시킬 수 있다.