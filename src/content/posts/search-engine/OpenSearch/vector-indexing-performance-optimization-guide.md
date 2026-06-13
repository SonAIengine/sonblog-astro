---
title: OpenSearch 벡터 인덱싱 성능 최적화 가이드
description: OpenSearch에서 대량 벡터 데이터를 빠르게 색인하기 위한 최적화 설정을 정리한다. Refresh Interval 비활성화,
  레플리카 제거, 네이티브 메모리 프리로드, 병렬 인제스트 등 색인 속도를 높이는 전략을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- 인덱싱
- 성능최적화
- Bulk API
- Search Engine
---


벡터 기반 검색 시스템에서는 대량의 벡터 데이터를 빠르게 색인하는 것이 중요하다.
OpenSearch는 이러한 작업의 성능을 향상시키기 위한 다양한 설정을 제공한다.


## 1. **Refresh Interval 비활성화**

- 기본값: `1초마다` 인덱스가 자동으로 refresh
    
- 대량 색인 시, 여러 개의 작은 세그먼트가 생성되어 **오버헤드 증가**
    
- 색인 중에는 **refresh를 비활성화**하고 완료 후 재활성화 권장

```json
# 비활성화
PUT /<index_name>/_settings
{
  "index": {
    "refresh_interval": "-1"
  }
}

# 색인 완료 후 복원
PUT /<index_name>/_settings
{
  "index": {
    "refresh_interval": "1s"
  }
}
```


## 2. **Replica 수 0으로 설정**

- 색인 중에는 Replica를 0으로 설정해 **불필요한 복제 인덱스 생성 방지**
    
- 색인 완료 후 Replicas를 다시 설정하면 인덱스가 복제될 때 **벡터 인덱스도 함께 복사**

```json
PUT /<index_name>/_settings
{
  "index": {
    "number_of_replicas": 0
  }
}
```

> ⚠️ 장애 시 데이터 손실 방지를 위해 **외부 백업 권장**


## 3. **색인 스레드 수 증가**

- `index_thread_qty`를 통해 **병렬 색인 작업 수행 가능**

설정값 예시
```http
PUT /_cluster/settings
{
  "persistent": {
    "knn.algo_param.index_thread_qty": 4
  }
}
```

> CPU 사용률을 모니터링하며 적절한 값으로 조정


## 4. **(OpenSearch 3.0+) Derived Vector Source로 저장 공간 절약**

- 벡터 필드를 `_source`에 저장하지 않고도 검색 기능 유지
    
- 기본값: **활성화됨**
    
- 장점
    
    - 저장 용량 절약
        
    - `update`, `update_by_query`, `reindex` 모두 가능
        


## 5. **(고급) 벡터 데이터 구조 지연 생성 전략**

### 개요

- 벡터 검색용 데이터 구조(HNSW 등)는 색인 시 자동 생성됨
    
- 대량 초기 업로드 이후 검색만 수행하는 경우, **이 구조 생성을 나중에 수행**하면 속도 개선 가능
    

### 단계별 구성

#### 1. 색인 시 벡터 구조 생성 비활성화

```http
PUT /test-index/
{
  "settings": {
    "index.knn.advanced.approximate_threshold": "-1"
  }
}
```

#### 2. Bulk 색인 수행

```http
POST _bulk
{ "index": { "_index": "test-index", "_id": "1" } }
{ "my_vector1": [1.5, 2.5], "price": 12.2 }
...
```

> ⚠️ 이 상태에서 검색하면 **정확한 k-NN 방식**으로 수행됨 (느림)

#### 3. 벡터 구조 생성 활성화

```http
PUT /test-index/_settings
{
  "index.knn.advanced.approximate_threshold": "0"
}
```

#### 4. Force Merge 수행 (세그먼트 1개로 통합)

```http
POST /test-index/_forcemerge?max_num_segments=1
```

> 이후 생성된 벡터 구조를 통해 **빠른 근사 검색**이 가능


## 정리: 성능 튜닝 체크리스트

| 항목                    | 설명                         |
| --------------------- | -------------------------- |
| Refresh Interval 비활성화 | 색인 중 작은 세그먼트 생성 방지         |
| Replica 0 설정          | 복제 인덱스 생성 오버헤드 제거          |
| 색인 스레드 수 조절           | 병렬 인덱싱 최적화                 |
| Derived Source 사용     | 저장 공간 절감                   |
| 벡터 구조 지연 생성           | Bulk 인덱싱 속도 향상 + 효율적 검색 구성 |
