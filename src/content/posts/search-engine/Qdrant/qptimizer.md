---
title: Qdrant Optimizer — 세그먼트 병합과 인덱스 자동 최적화
description: Qdrant의 자동 최적화(Optimizer) 기능을 정리한다. 세그먼트 병합, 디스크 공간 회수, HNSW 인덱스 자동 생성,
  Proxy Segment와 Copy-On-Write 전략에 의한 무중단 최적화를 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Optimizer
- 세그먼트
- 성능최적화
- Search Engine
---


Qdrant는 벡터 데이터의 저장 및 검색 성능을 유지하기 위해 다양한 자동 최적화(optimizer) 기능을 제공한다. 

이 최적화는 주로 **세그먼트(segment)** 단위로 작동하며, 디스크 공간 회수, 세그먼트 병합, 인덱스 생성 등 다양한 기능을 수행한다.

모든 Optimizer는 설정 파일 또는 컬렉션 단위의 파라미터로 구성할 수 있으며, 시스템의 성능 요구사항에 따라 조정이 가능하다.


## 1. Segment 최적화 구조

Qdrant는 데이터 저장 구조가 불변(immutable)에 가까우므로, 변경 사항은 기존 구조를 부분적으로 재구성하거나 전체를 복제한 뒤 새로 구성해야 한다. 이때 **Proxy Segment**와 **Copy-On-Write** 전략을 이용하여, 최적화 도중에도 세그먼트는 읽기 가능한 상태로 유지된다.


## 2. Vacuum Optimizer

### 목적

삭제된 포인트들이 디스크에 계속 남아 시스템 리소스를 소모하는 문제를 해결하기 위한 최적화이다. Qdrant는 삭제 요청 시 데이터를 즉시 제거하지 않고 "삭제 표시"만 하며, 추후 Vacuum Optimizer에 의해 물리적으로 제거된다.

### 작동 조건

```yaml
storage:
  optimizers:
    deleted_threshold: 0.2  # 세그먼트 내 삭제 벡터 비율 임계치 (20%)
    vacuum_min_vector_number: 1000  # 최소 벡터 수
```

해당 조건을 만족하는 세그먼트는 최적화 대상이 되어 삭제된 데이터를 실제로 제거하고 디스크 공간을 회수한다.


## 3. Merge Optimizer

### 목적

작은 세그먼트가 지나치게 많아지는 경우 검색 성능이 저하되므로, 이를 병합하여 일정 수 이하로 유지하는 기능이다. 병합은 보통 가장 작은 세그먼트 3개를 하나로 합치는 방식으로 진행된다.

### 주요 설정

```yaml
storage:
  optimizers:
    default_segment_number: 0  # 유지하려는 세그먼트 수 (0 = CPU 수 기준 자동 설정)
    max_segment_size_kb: null # 병합 후 세그먼트 최대 크기 제한 (설정하지 않으면 자동)
```

- **default_segment_number**는 검색 스레드 수에 따라 조정되는 것이 권장된다.
    
- **max_segment_size_kb**를 설정하면 인덱싱 성능과 검색 성능 간의 균형을 조절할 수 있다.


## 4. Indexing Optimizer

### 목적

데이터 양이 많아질 경우 수동 인덱스 설정 없이 자동으로 인덱스를 생성하거나, 메모리에서 디스크로 옮기는 방식으로 스토리지 최적화를 수행한다.

### 주요 설정

```yaml
storage:
  optimizers:
    memmap_threshold: 200000  # 메모리에 유지할 최대 세그먼트 크기(KB), 초과 시 디스크(mmap) 저장
    indexing_threshold_kb: 20000  # 벡터 인덱스 생성 기준 용량(KB)
```

- **memmap_threshold**는 메모리 사용량을 줄이기 위한 설정이다.
    
- **indexing_threshold_kb**를 초과하면 브루트포스 검색 대신 인덱스를 생성하여 검색 속도를 향상시킨다.


## 5. 컬렉션 단위 설정 변경

Optimizer 설정은 글로벌 설정 외에도 **컬렉션 단위**로 개별 지정이 가능하다. 

예를 들어, 대용량 데이터를 처음 업로드할 때는 인덱싱을 비활성화한 뒤 업로드가 완료된 후에 인덱싱을 활성화할 수 있다. 이로써 불필요한 인덱스 재생성을 피하고 성능을 최적화할 수 있다.

```json
PATCH /collections/{collection_name}
{
  "optimizers_config": {
    "indexing_threshold": 0
  }
}
```


## 6. 정리 및 활용 전략

Qdrant의 Optimizer들은 벡터 검색 시스템에서 자주 발생하는 성능 저하 문제를 자동으로 해결해준다. 다음과 같은 상황에서 효과적으로 활용할 수 있다.

| 사용 사례            | 활용 Optimizer                   |
| ---------------- | ------------------------------ |
| 삭제된 포인트 정리       | Vacuum Optimizer               |
| 작은 세그먼트 병합       | Merge Optimizer                |
| 대량 업로드 이후 인덱싱 전환 | Indexing Optimizer             |
| 디스크 메모리 절감       | memmap + indexing threshold 조합 |


## 결론

Qdrant의 Optimizer는 대규모 벡터 데이터의 성능 저하를 예방하고, 검색 품질을 유지하기 위한 핵심 구성 요소이다. 특히 데이터가 지속적으로 삽입, 삭제, 업데이트되는 실시간 시스템 환경에서는 자동 최적화 설정이 시스템 안정성과 성능을 결정짓는 중요한 요소가 된다.

각 Optimizer의 조건을 상황에 맞게 조정하고, 필요 시 컬렉션별로 세분화된 설정을 적용하면 Qdrant의 성능을 최대한 활용할 수 있다.