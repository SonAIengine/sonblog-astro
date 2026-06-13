---
title: Qdrant Storage — 벡터 저장 구조와 메모리/디스크 전략
description: Qdrant의 세그먼트 기반 저장 구조를 정리한다. 벡터와 페이로드의 In-memory, Memmap, On-disk 저장
  방식, WAL 설정, 버전 관리 전략을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 스토리지
- Memmap
- 세그먼트
- Search Engine
---


Qdrant는 고성능 벡터 검색을 지원하기 위해 **세그먼트(segment)** 기반의 저장 구조를 채택하고 있다. 

각 세그먼트는 독립적인 벡터와 페이로드 저장소, 인덱스를 보유하며, 이를 통해 읽기/쓰기 성능과 확장성을 동시에 확보한다. 

이 글에서는 Qdrant의 벡터 및 페이로드 저장 방식, 메모리/디스크 설정, 그리고 버전 관리 방식에 대해 정리한다.

## 1. 세그먼트(Segment) 구조

Qdrant에서 하나의 컬렉션은 여러 개의 세그먼트로 구성된다. 각 세그먼트는 다음과 같은 구성 요소를 포함한다.

- **벡터 저장소**
    
- **페이로드 저장소**
    
- **벡터 및 페이로드 인덱스**
    
- **ID 매퍼** (내부 ID와 외부 ID 간의 매핑)
    

세그먼트는 **appendable** 또는 **non-appendable**로 나뉜다.

| 세그먼트 유형        | 설명                         |
| -------------- | -------------------------- |
| appendable     | 데이터 추가, 수정, 삭제 가능          |
| non-appendable | 읽기와 삭제만 가능 (보통 압축/최적화된 상태) |

하나의 컬렉션에는 반드시 최소 하나 이상의 `appendable` 세그먼트가 존재해야 한다.


## 2. 벡터 저장 방식 (Vector Storage)

Qdrant는 벡터를 저장할 때 다음 두 가지 방식 중 선택할 수 있다.

### 2.1 In-Memory 저장소

- 모든 벡터를 RAM에 상주시켜 가장 빠른 검색 속도를 제공한다.
    
- 디스크는 persistence 용도로만 사용된다.
    
- 메모리가 충분한 환경에서 권장된다.

### 2.2 Memmap 저장소

- 디스크에 저장된 파일을 가상 메모리처럼 접근하는 방식이다.
    
- OS의 페이지 캐시를 활용하여 성능 저하 없이 대용량 데이터 처리가 가능하다.
    
- RAM이 제한적인 환경에서도 대규모 데이터를 효율적으로 검색할 수 있다.


## 3. Memmap 설정 방법

### 3.1 컬렉션 생성 시 직접 설정

```json
PUT /collections/{collection_name}
{
  "vectors": {
    "size": 768,
    "distance": "Cosine",
    "on_disk": true
  }
}
```

위 설정은 벡터 데이터를 곧바로 디스크 기반(memmap)으로 저장하도록 한다.

### 3.2 Optimizer 기반 동적 전환

memmap_threshold 값을 설정하면 일정 크기 이상 세그먼트가 자동으로 memmap으로 전환된다.

```json
PUT /collections/{collection_name}
{
  "vectors": {
    "size": 768,
    "distance": "Cosine"
  },
  "optimizers_config": {
    "memmap_threshold": 20000
  }
}
```

- RAM이 적거나 쓰기 빈도가 높은 환경: `memmap_threshold` < `indexing_threshold`
    
- 일반적인 환경: `memmap_threshold` = `indexing_threshold`

### 3.3 HNSW 인덱스 on-disk 설정

HNSW 인덱스도 memmap으로 저장할 수 있다.

```json
PUT /collections/{collection_name}
{
  "vectors": {
    "size": 768,
    "distance": "Cosine",
    "on_disk": true
  },
  "hnsw_config": {
    "on_disk": true
  }
}
```


## 4. 페이로드 저장 방식 (Payload Storage)

Qdrant는 페이로드 데이터의 저장소도 선택할 수 있다.

| 저장 방식        | 설명                          |
| ------------ | --------------------------- |
| **InMemory** | 서비스 시작 시 모든 페이로드를 RAM에 적재   |
| **OnDisk**   | RocksDB에 직접 저장, RAM 사용량 최소화 |

- **InMemory**는 빠른 검색이 가능하지만, 대용량 텍스트나 이미지 등 메모리 소모가 크다.
    
- **OnDisk**는 RAM을 절약할 수 있지만, 필터 조건에 따라 검색 속도가 느려질 수 있다.

> 필터링 성능을 유지하려면, 자주 사용하는 필드에 대해 **payload index**를 설정하는 것이 권장된다.  
> 인덱스를 설정하면 해당 필드는 RAM에 유지되므로 OnDisk의 단점이 완화된다.

컬렉션 생성 시 OnDisk payload 설정 예시

```json
PUT /collections/{collection_name}
{
  "on_disk_payload": true
}
```


## 5. 버전 관리 (Versioning)

Qdrant는 모든 데이터 변경을 안전하게 관리하기 위해 **2단계 저장 전략**을 사용한다.

1. **Write-Ahead Log (WAL)**에 먼저 기록하고, 순차 번호(version)를 부여한다.
    
2. 이후 변경 사항은 세그먼트에 반영된다.
    

- WAL에 기록된 시점 이후의 데이터는 시스템 장애 발생 시에도 복구가 가능하다.
    
- 각 세그먼트는 최종 변경된 버전 정보를 저장하며, 과거 순서의 변경 요청은 무시된다.
    

이러한 구조는 시스템 재시작 후에도 데이터를 일관되게 복구할 수 있도록 보장한다.


## 결론

Qdrant는 **세그먼트 기반 저장 구조**를 중심으로 하여, **RAM 우선**과 **디스크 기반 저장소**, 그리고 **다양한 최적화 전략**을 유연하게 결합할 수 있는 저장소 설계를 제공한다. 대규모 데이터셋에서 검색 성능을 유지하면서도 시스템 자원 사용을 최적화하려면 다음 요소를 고려한 설계가 중요하다:

- 벡터 저장소 선택: RAM vs. Memmap
    
- 페이로드 저장소 선택: InMemory vs. OnDisk
    
- 필터 조건이 자주 사용되는 필드에 대한 payload index 구성
    
- 초기 데이터 적재 후 indexing 및 memmap 최적화 시점 조정
    
- 장애 복구 및 데이터 일관성을 위한 WAL 기반 버전 관리


Qdrant의 저장 구조는 단순한 검색 엔진을 넘어서, 실시간 벡터 기반 시스템의 고가용성과 유연한 리소스 운용을 가능하게 한다. 필요에 따라 최적화 전략과 연결하여 시스템 전체의 성능을 극대화할 수 있다.