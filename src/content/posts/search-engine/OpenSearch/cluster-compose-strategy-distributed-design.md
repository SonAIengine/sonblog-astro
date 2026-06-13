---
title: OpenSearch 클러스터 구성 전략 — node.roles와 샤드 분산 설계
description: OpenSearch 클러스터의 노드 역할(cluster_manager, data, ingest, ml, search) 분리와
  샤드 분산 전략을 정리한다. 노드 역할별 리소스 배분과 인덱스 분산 설계 방법을 다룬다.
pubDatetime: 2025-07-18
tags:
- OpenSearch
- 검색엔진
- 클러스터
- 샤드
- node.roles
- 인프라
- Search Engine
---


## 1. `node.roles` – 노드 역할 정의

OpenSearch 클러스터는 각 노드에 역할을 부여함으로써 기능을 분리하고 리소스를 효율적으로 분산시킬 수 있다.

| 역할       | 키워드                 | 설명                                                                           |
| -------- | ------------------- | ---------------------------------------------------------------------------- |
| 클러스터 관리자 | `"cluster_manager"` | 클러스터 메타데이터(노드 등록, 마스터 선출 등)를 관리하는 노드이다.                                      |
| 데이터 노드   | `"data"`            | 인덱스의 샤드 데이터를 저장하고 읽기 및 쓰기 요청을 처리한다.                                          |
| 인제스트 노드  | `"ingest"`          | 데이터 수집 시 전처리 파이프라인을 적용하는 노드이다.                                               |
| 머신러닝 노드  | `"ml"`              | 모델 서빙, 이상 탐지 등의 ML 기능을 수행하는 노드이다.                                            |
| 검색 전용 노드 | `"search"`          | 읽기(검색) 작업만 수행하도록 제한할 수 있는 노드이다.                                              |
| 조정 전용 노드 | 빈 배열 `[]`           | 쿼리 라우팅 등만 수행하며 클러스터 메타데이터나 데이터 샤드를 가지지 않는다. 주로 OpenSearch Dashboards에서 사용한다. |

### 권장 노드 배치

- `m1`: `["cluster_manager"]`
    
- `d1`, `d2`: `["data", "ingest"]`
    
- `ml1`: `["ml"]`
    
- `c1`: `[]`


## 2. `node.attr` – 사용자 정의 노드 속성

`node.attr.<속성명>=<값>` 형식으로 노드에 메타데이터를 설정할 수 있으며, 샤드 분산 정책, 수명 기반 티어링(Hot/Warm/Cold), 장애 도메인 분산 등에 활용된다.

|속성명|예시|용도|
|---|---|---|
|`zone`|`zone-a`, `zone-b`|가용 영역(AZ) 기반으로 샤드 복제본 분산에 사용된다.|
|`temp`|`hot`, `warm`, `cold`|데이터의 수명 주기에 따라 핫/웜/콜드 티어를 지정한다.|
|`rack`|`rack1`, `rack2`|물리적 장애 도메인 분산을 위해 설정할 수 있다.|

### 예시 설정

```yaml
node.attr.zone: zone-a
node.attr.temp: hot
```


## 3. 샤드 및 복제 설정 정책

OpenSearch는 인덱스를 생성할 때 Primary Shard와 Replica Shard를 지정하여 데이터를 분산 저장하고, 고가용성과 병렬처리를 보장한다.

### 주요 개념

- **Primary Shard**: 원본 데이터를 저장하는 샤드이다.
    
- **Replica Shard**: Primary의 복제본으로, 장애 복구 및 읽기 처리에 활용된다.

### 샤드 배치 공식

```
샤드 수 × (복제 수 + 1) = 클러스터가 필요로 하는 총 샤드 수
```

이 공식은 데이터 노드 수에 기반하여 적절한 샤드 구성을 판단하는 기준이 된다.

|샤드 수|복제 수|총 샤드 수|최소 권장 데이터 노드 수|
|---|---|---|---|
|3|1|6|2개 이상|
|5|2|15|3개 이상|

### 인덱스 생성 시 설정 예시

```json
PUT /my-index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}
```


## 4. 샤드 할당 인식 설정

`cluster.routing.allocation.awareness` 설정은 샤드가 특정 `node.attr` 값(zone, rack 등)을 기준으로 고르게 분산되도록 강제하는 기능이다. 이를 통해 특정 zone이나 rack에 모든 primary/replica가 몰리는 것을 방지할 수 있다.

### 클러스터 수준 설정 예시

```json
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.awareness.attributes": "zone"
  }
}
```

이 설정을 통해 OpenSearch는 샤드를 `zone` 속성에 따라 자동으로 균등 분산하게 된다.


## 5. 실전 예시 시나리오

> 클러스터를 다음과 같이 구성하고자 한다.
> 
> - `m1` 노드는 클러스터 관리자 역할만 수행한다.
>     
> - `d1`, `d2`는 데이터 저장 및 인제스트 작업을 처리한다.
>     
> - `ml1`은 ML 기능만 수행한다.
>     
> - `c1`은 대시보드 연결 전용이다.
>     
> - `zone-a`, `zone-b`로 나눠 이중화하고, hot/warm 티어도 적용한다.
>     

이때 노드 설정은 다음과 같다.

|노드|`node.roles`|`node.attr.zone`|`node.attr.temp`|
|---|---|---|---|
|m1|`["cluster_manager"]`|`zone-a`|없음|
|d1|`["data", "ingest"]`|`zone-a`|`hot`|
|d2|`["data", "ingest"]`|`zone-b`|`warm`|
|ml1|`["ml"]`|`zone-b`|없음|
|c1|`[]` (coordinating only)|`zone-a`|없음|

그리고 클러스터 설정은 다음과 같이 적용한다.

```json
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.awareness.attributes": "zone"
  }
}
```

인덱스를 만들 때는 다음과 같이 샤드와 복제본 수를 설정한다.

```json
PUT /your-index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}
```


## 요약

|항목|설명|예시|
|---|---|---|
|`node.roles`|노드의 역할 정의|`["data", "ingest"]`, `["ml"]`, `[]`|
|`node.attr`|샤드 분산 및 티어링 정책|`zone: zone-a`, `temp: hot`|
|`number_of_shards`|인덱스의 기본 샤드 수|`3`|
|`number_of_replicas`|복제본 수|`1`|
|`cluster.routing.allocation.awareness`|zone/rack 기반 분산 샤드 배치|`"zone"`|
