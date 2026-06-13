---
title: Qdrant Indexing — 벡터 인덱스와 페이로드 인덱스 구성 가이드
description: Qdrant의 인덱싱 구조를 정리한다. HNSW 기반 벡터 인덱스, 페이로드 필드별 인덱스 타입, 인덱싱 임계값 설정, 필터링
  성능 최적화를 위한 인덱스 구축 전략을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- HNSW
- 인덱싱
- Payload인덱스
- Search Engine
---


Qdrant는 **벡터 인덱스와 전통적인 페이로드 인덱스를 함께 사용할 수 있는 벡터 검색 엔진**이다. 

필터링 조건이 포함된 고속 유사도 검색을 가능하게 하기 위해서는 벡터 인덱스뿐 아니라 페이로드 인덱스도 함께 구축되어야 한다. 

Qdrant는 다양한 인덱스 타입과 설정을 통해 이러한 기능을 유연하게 제공한다.

## 1. 인덱스 구성 원칙

- **벡터 인덱스**는 유사도 검색 속도를 향상시킨다.
    
- **페이로드 인덱스**는 필터링 속도를 향상시킨다.
    
- 모든 세그먼트가 인덱스를 갖는 것은 아니며, 필요 여부는 Optimizer 설정과 데이터 규모에 따라 자동 결정된다.
    
- 인덱스 설정은 컬렉션 수준에서 설정된다.


## 2. 페이로드 인덱스 (Payload Index)

문서형 데이터베이스의 필드 인덱스와 유사하게 작동한다. 특정 필드에 대해 빠른 조건 검색이 가능해진다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "city",
  "field_schema": "keyword"
}
```

### 지원 타입

| 타입       | 설명                             |
| -------- | ------------------------------ |
| keyword  | 문자열 필드용 (Match)                |
| integer  | 정수값 필드용 (Match, Range)         |
| float    | 실수값 필드용 (Range)                |
| bool     | 불리언 필드용 (Match, v1.4.0 이상)     |
| geo      | 위치 정보 (Bounding Box, Radius 등) |
| datetime | 날짜 필드용 (Range, v1.8.0 이상)      |
| text     | 전문 검색용 인덱스 (Full Text)         |
| uuid     | UUID 문자열 필드 최적화 (v1.11.0 이상)   |

> 필터링 조건으로 자주 사용되는 필드만 인덱싱하는 것이 메모리 효율적이다. 값의 종류가 많은 필드일수록 인덱싱 효과가 크다.


## 3. Full Text 인덱스

텍스트 검색을 위한 특수한 인덱스 타입이다. 텍스트를 토큰 단위로 분리하여 역색인 구조로 저장한다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "description",
  "field_schema": {
    "type": "text",
    "tokenizer": "word",
    "min_token_len": 2,
    "max_token_len": 20,
    "lowercase": true
  }
}
```

### 지원 토크나이저

- `word`: 일반적인 단어 기준 분할
    
- `whitespace`: 공백 기준 분할
    
- `prefix`: 접두사 기반 검색
    
- `multilingual`: 다양한 언어 지원 (빌드시 옵션 필요)


## 4. 파라미터 인덱스 (Parameterized Index)

정수 필드(integer)에 대해 `lookup`, `range`를 독립적으로 지정하여 인덱스 성능을 조절할 수 있다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "score",
  "field_schema": {
    "type": "integer",
    "lookup": false,
    "range": true
  }
}
```

- `lookup: true` → Match 필터 지원
    
- `range: true` → Range 필터 지원
    
- 둘 중 하나만 활성화하면 메모리 사용량과 성능을 최적화할 수 있다.


## 5. 디스크 기반 인덱스 (On-Disk Payload Index)

기본적으로 모든 페이로드 인덱스는 메모리에 유지된다. 하지만 인덱스 크기가 크거나 자주 사용되지 않는 경우 디스크 기반 인덱스를 사용할 수 있다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "uuid",
  "field_schema": {
    "type": "uuid",
    "on_disk": true
  }
}
```

> 지원 타입: keyword, integer, float, datetime, uuid, text, geo


## 6. 멀티테넌시 인덱스 (Tenant Index)

여러 테넌트를 포함한 컬렉션에서 특정 필드 기준으로 서브 인덱스를 분리 구성할 수 있다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "tenant_id",
  "field_schema": {
    "type": "keyword",
    "is_tenant": true
  }
}
```

- `is_tenant: true`로 설정된 필드는 디스크상에서 테넌트 단위로 클러스터링되어 검색 효율을 향상시킨다.
    
- 지원 타입: keyword, uuid

## 7. 주 필드 인덱스 (Principal Index)

시간이나 순서 기반 검색이 많은 경우, 특정 필드를 기준으로 검색 최적화를 수행할 수 있다.

```json
PUT /collections/{collection_name}/index
{
  "field_name": "timestamp",
  "field_schema": {
    "type": "datetime",
    "is_principal": true
  }
}
```

- 시간 필터 기반 쿼리를 빠르게 처리할 수 있다.
    
- 지원 타입: integer, float, datetime


## 8. 벡터 인덱스 (Vector Index)

Qdrant는 현재 **HNSW(Hierarchical Navigable Small World)** 인덱스를 벡터 인덱스로 사용한다.

### HNSW 개요

- 다층 그래프 구조
    
- 상위 레벨: 간선 적음, 거리 멀다
    
- 하위 레벨: 간선 많음, 거리 가깝다
    
- 검색은 상위에서 시작하여 점점 정확하게 이동

### 설정 예시

```yaml
storage:
  hnsw_index:
    m: 16  # 노드당 최대 연결 수
    ef_construct: 100  # 인덱스 생성 시 탐색 폭
    full_scan_threshold: 10000  # 필터가 강하면 전체 스캔 우선
```

- `m`: 정확도 및 메모리 사용량에 영향
    
- `ef_construct`: 인덱스 구축 속도 ↔ 정확도
    

컬렉션 생성 시 또는 vector별로 `hnsw_config`를 설정할 수 있다.


## 9. 스파스 벡터 인덱스 (Sparse Vector Index)

스파스 벡터는 대부분의 값이 0인 벡터로, 효율적인 인덱스가 필요하다. Qdrant는 역색인 기반 구조를 사용하여 정확한 검색을 수행한다.

```json
PUT /collections/{collection_name}
{
  "sparse_vectors": {
    "text": {
      "index": {
        "on_disk": false
      }
    }
  }
}
```

- on_disk: true → 디스크 저장 (메모리 절약, 속도 저하 가능)
    
- on_disk: false → 메모리에 유지 (빠른 검색)
    

> 스파스 벡터 인덱스는 Dot Product만 지원하며, 고정된 차원 설정이 필요 없다.


## 10. IDF Modifier

스파스 벡터에서 희소한 단어에 가중치를 두는 **Inverse Document Frequency(IDF)** 기법을 자동으로 적용할 수 있다.

```json
PUT /collections/{collection_name}
{
  "sparse_vectors": {
    "text": {
      "modifier": "idf"
    }
  }
}
```

- 자주 등장하지 않는 토큰일수록 가중치를 높여 검색 품질을 향상시킨다.
    
- 스트리밍 인퍼런스 환경에서 유용하게 활용된다.

## 11. Filtrable Index (결합형 인덱스 최적화)

Qdrant는 필터 조건이 너무 약하거나 너무 강할 경우, HNSW 단독 사용 또는 Full Scan 방식이 각각 적합하다. 하지만 중간 난이도의 조건에 대해서는 적절한 최적화가 필요하다.

이를 위해 Qdrant는 **필터 조건 기반으로 추가 간선을 갖는 HNSW 구조**를 사용한다. 검색 중 조건을 만족하는 벡터만 탐색하여 불필요한 점수 계산을 줄이고 검색 속도를 유지한다.


## 결론

Qdrant의 인덱싱 구조는 다음과 같은 특징을 가진다.

- **벡터 검색 + 필터링을 병행**하기 위한 구조
    
- **HNSW 기반 고속 벡터 인덱싱**과 다양한 페이로드 인덱스를 지원
    
- **텍스트, 위치 정보, 날짜/시간, UUID** 등 다양한 필드에 대해 최적화 가능
    
- **테넌시 및 시간 기반 검색 최적화 기능** 내장
    

복합적인 검색 조건, 대규모 데이터셋, 다양한 필터 조건을 고려한 검색 성능을 확보하고자 할 때, Qdrant의 인덱스 설정은 매우 중요한 구성 요소가 된다.