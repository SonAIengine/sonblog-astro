---
title: Qdrant Filtering — Payload 기반 필터링 조건과 구문 가이드
description: Qdrant의 벡터 검색에서 payload와 ID 기반 필터링을 적용하는 방법을 정리한다. must/should/must_not
  논리 연산자, 범위/매칭/지리 필터, 중첩 필터 구문까지 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 필터링
- Payload
- 쿼리
- Search Engine
---



Qdrant는 벡터 기반 유사도 검색 외에도, 포인트(point)의 **payload**나 **ID**에 기반한 다양한 필터링 조건을 지원한다. 

이는 단순한 임베딩 표현만으로는 설명할 수 없는 실무상의 제약 조건들(예: 재고 여부, 지역 제한, 가격 범위 등)을 검색 결과에 반영하는 데 매우 유용하다.


## 1. 필터링 구문 구조 (Clauses)

Qdrant는 논리적 조건들을 조합하여 검색 조건을 구성할 수 있다. 기본적으로 다음과 같은 연산자를 지원한다.

|구문|설명|
|---|---|
|`must`|모든 조건을 만족해야 함 (AND)|
|`should`|하나 이상의 조건을 만족하면 됨 (OR)|
|`must_not`|모든 조건이 만족되지 않아야 함 (NOT)|

### 예시 데이터

```json
[
  { "id": 1, "city": "London", "color": "green" },
  { "id": 2, "city": "London", "color": "red" },
  { "id": 3, "city": "London", "color": "blue" },
  { "id": 4, "city": "Berlin", "color": "red" },
  { "id": 5, "city": "Moscow", "color": "green" },
  { "id": 6, "city": "Moscow", "color": "blue" }
]
```

### must

```json
"must": [
  { "key": "city", "match": { "value": "London" } },
  { "key": "color", "match": { "value": "red" } }
]
```

결과: ID 2

### should

```json
"should": [
  { "key": "city", "match": { "value": "London" } },
  { "key": "color", "match": { "value": "red" } }
]
```

결과: ID 1, 2, 3, 4

### must_not

```json
"must_not": [
  { "key": "city", "match": { "value": "London" } },
  { "key": "color", "match": { "value": "red" } }
]
```

결과: ID 5, 6

### 혼합 사용

```json
{
  "must": [{ "key": "city", "match": { "value": "London" } }],
  "must_not": [{ "key": "color", "match": { "value": "red" } }]
}
```

결과: ID 1, 3


## 2. 필터 조건 유형

### Match

단일 값과의 일치 여부를 검사한다.

```json
{ "key": "color", "match": { "value": "red" } }
```

지원: 문자열, 정수, 불리언

### Match Any (OR 조건)

```json
{ "key": "color", "match": { "any": ["red", "green"] } }
```

값이 여러 개일 경우, 그 중 하나라도 포함되면 true가 된다.

### Match Except (NOT IN 조건)

```json
{ "key": "color", "match": { "except": ["red", "green"] } }
```

모든 값이 제외 대상에 포함되지 않아야 만족된다.


## 3. 중첩 필드(Nested Key)

Qdrant는 JSON 형태의 payload를 지원하므로, 중첩 필드에 대한 검색도 가능하다.

```json
{ "key": "country.name", "match": { "value": "Germany" } }
```

배열 내부에 있는 값도 다음과 같이 지정할 수 있다.

```json
{ "key": "country.cities[].population", "range": { "gte": 9.0 } }
```

배열 요소의 속성값 중 하나라도 조건을 만족하면 해당 포인트는 결과에 포함된다.


## 4. 중첩 오브젝트 필터 (Nested Object Filter)

배열의 각 객체를 독립적으로 평가하려면 `nested` 조건을 사용한다.

```json
{
  "nested": {
    "key": "diet",
    "filter": {
      "must": [
        { "key": "food", "match": { "value": "meat" } },
        { "key": "likes", "match": { "value": true } }
      ]
    }
  }
}
```

이 방식은 한 객체 안에서 모든 조건이 충족되는지 평가하므로, 정확한 조합 검색이 가능하다.


## 5. 고급 필터링 조건

### Full Text Match

문자열 필드 내 텍스트 검색

```json
{ "key": "description", "match": { "text": "good cheap" } }
```

단어가 모두 포함되어야 일치로 간주된다.

### Range

```json
{
  "key": "price",
  "range": {
    "gte": 100.0,
    "lte": 450.0
  }
}
```

지원: 정수, 실수

### Datetime Range

RFC 3339 포맷을 그대로 사용할 수 있다.

```json
{
  "key": "date",
  "range": {
    "gt": "2023-02-08T10:49:00Z",
    "lte": "2024-01-31T10:14:31Z"
  }
}
```

### UUID Match

```json
{ "key": "uuid", "match": { "value": "550e8400-e29b-41d4-a716-446655440000" } }
```

문자열과 유사하게 작동하며, uuid 인덱스를 사용하는 것이 메모리 측면에서 효율적이다.


## 6. Geo 필터

### geo_bounding_box

```json
{
  "key": "location",
  "geo_bounding_box": {
    "top_left": { "lat": 52.5207, "lon": 13.4036 },
    "bottom_right": { "lat": 52.4958, "lon": 13.4558 }
  }
}
```

### geo_radius

```json
{
  "key": "location",
  "geo_radius": {
    "center": { "lat": 52.5207, "lon": 13.4036 },
    "radius": 1000.0
  }
}
```

### geo_polygon

```json
{
  "key": "location",
  "geo_polygon": {
    "exterior": {
      "points": [ ... ]
    },
    "interiors": [ ... ]
  }
}
```

복잡한 지역 범위 설정에 유용하다.


## 7. 기타 조건

### values_count

```json
{
  "key": "comments",
  "values_count": {
    "gt": 2
  }
}
```

배열 값 개수가 특정 조건을 만족하는 경우에 필터링한다.

### is_empty

```json
{
  "is_empty": { "key": "reports" }
}
```

해당 필드가 없거나 빈 배열 또는 null일 경우 일치한다.

### is_null

```json
{
  "is_null": { "key": "reports" }
}
```

해당 필드가 null 값일 경우 일치한다.


## 8. ID/벡터 존재 조건

### has_id

```json
{ "has_id": [1, 3, 5] }
```

특정 ID에 해당하는 포인트만 필터링한다.

### has_vector

```json
{ "has_vector": "image" }
```

특정 Named Vector가 존재하는 포인트만 필터링한다. Named Vector가 없는 경우 빈 문자열 `""`로 지정한다.


## 결론

Qdrant는 단순한 유사도 기반 검색뿐만 아니라 다양한 실무 제약을 표현할 수 있도록 풍부한 필터링 기능을 제공한다. Boolean 조합, 범위 조건, 배열 필드, 중첩 구조, 위치 기반 필터, 텍스트 매칭 등 거의 모든 구조의 조건을 표현할 수 있다.

이러한 필터 기능을 적절히 활용하면 Qdrant를 매우 정밀하고 강력한 검색 엔진으로 구성할 수 있다.