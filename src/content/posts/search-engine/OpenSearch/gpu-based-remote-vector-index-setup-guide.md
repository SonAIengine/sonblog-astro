---
title: OpenSearch 3.0 GPU 기반 원격 벡터 인덱스 구축 가이드
description: OpenSearch 3.0의 GPU 가속 원격 인덱스 빌드 기능을 정리한다. Faiss HNSW + FP32 벡터 대상으로
  GPU를 활용해 인덱스 구축 속도를 높이고 CPU 대비 비용을 절감하는 방법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- GPU
- FAISS
- HNSW
- Search Engine
---


OpenSearch(v3.0.0)는 **GPU 가속 원격 인덱스 빌드 서비스**를 통해 벡터 인덱스를 더 빠르고 효율적으로 구축할 수 있다.

이 기능은 **Faiss 엔진 + HNSW 알고리즘** + **FP32(32-bit float)** 벡터에 대해 지원된다.

## 주요 이점

- GPU 사용으로 **색인 속도 대폭 향상**
    
- **CPU 기반 색인 대비 비용 절감**
    
- 색인 처리가 **OpenSearch 외부에서 비동기적으로 수행됨**


## 사전 준비 사항

1. **Faiss 엔진 + HNSW 메서드**를 사용하는 인덱스만 지원
    
2. **벡터 타입: FP32 (32-bit float)**
    
3. **AWS S3 저장소 필수** (중간 저장소 역할)


## 1단계: 원격 인덱스 빌드 기능 활성화

### 클러스터 설정 (Dynamic)

```json
PUT /_cluster/settings
{
  "persistent": {
    "knn.remote_index_build.enabled": true
  }
}
```

### 인덱스 설정 (Dynamic)

```json
PUT /my-index/_settings
{
  "index": {
    "knn.remote_index_build.enabled": true
  }
}
```

> 두 설정이 **모두 true**여야 인덱스에 대해 원격 빌드가 활성화됨


## 2단계: 원격 벡터 저장소(S3) 등록

OpenSearch 클러스터는 벡터와 문서 ID를 **S3 저장소**에 업로드하며, 원격 GPU 빌더는 이를 가져와 외부에서 인덱스를 생성한 뒤 결과를 다시 저장소에 업로드한다.

### 저장소 등록 예시

```json
PUT _snapshot/remote-knn-repo
{
  "type": "s3",
  "settings": {
    "bucket": "my-knn-bucket",
    "region": "us-west-2"
  }
}
```

### 클러스터에 저장소 지정

```json
PUT /_cluster/settings
{
  "persistent": {
    "knn.remote_index_build.repository": "remote-knn-repo"
  }
}
```


## 3단계: 원격 인덱스 빌드 서비스(endpoint) 설정

- GPU 빌드 서버를 직접 운영하고 있다면, 아래와 같이 설정
    

```json
PUT /_cluster/settings
{
  "persistent": {
    "knn.remote_index_build.service.endpoint": "https://my-knn-builder.example.com"
  }
}
```

> GPU 빌더 서비스 구성에 대한 자세한 내용은 공식 **User Guide** 참조


## 동작 방식

- **Flush 또는 Merge** 시, 다음 조건을 만족하는 경우 GPU 빌드 경로로 전환:
    
    1. 인덱스 설정이 지원 구성을 따름 (Faiss + HNSW + FP32)
        
    2. 세그먼트 크기가 설정된 범위 내에 있음
        
        - 최소: `index.knn.remote_index_build.size.min`
            
        - 최대: `knn.remote_index_build.size.max`
            
- 빌드 작업은 백그라운드에서 자동 실행됨
    

## 모니터링 방법

**k-NN Stats API**를 사용해 원격 인덱스 빌드 작업 상태를 확인 가능:

```http
GET /_plugins/_knn/stats
```

- `remote_index_build` 항목에서 현재 작업량, 성공/실패 통계 등을 확인할 수 있음


## 정확히 뭐가 좋나?
### 1. **인덱싱 속도 대폭 향상**

- 기존에는 벡터를 색인할 때 OpenSearch 노드가 **CPU로 직접 벡터 인덱스(HNSW 등)를 생성**해야 했음.
    
- 이 작업은 특히 수십만~수백만 개의 벡터를 색인할 때 **병목**이 발생함.
    
- GPU를 사용하면 **병렬 연산으로 수십 배 빠르게** 인덱스를 생성할 수 있음.
    
    - 예: 수백만 개 벡터를 수 분 내 색인 가능 (CPU보다 수십~수백 배 빠름)

### 2. **OpenSearch 노드의 CPU 자원 절약**

- 인덱스 생성 작업은 CPU를 많이 소모함 → 검색 성능에도 영향
    
- GPU 기반 원격 빌드는 색인 작업을 **OpenSearch 외부의 별도 GPU 서버에서 처리**하므로
    
    - OpenSearch 노드의 CPU 사용률이 낮아짐
        
    - **검색 성능 유지 + 인덱싱 작업 병렬화 가능**

### 3. **대규모 색인 작업에 최적화**

- 벡터가 수십만~수천만 개 이상인 경우, 일반 색인은 **시간도 오래 걸리고 노드에 과부하**를 줄 수 있음
    
- 이 기능은 **초기 대량 업로드 또는 정기 배치 색인 작업**에 특히 유용


### 4. **자동 연동 및 병렬 처리 구조**

- OpenSearch에서 **세그먼트가 일정 크기를 넘을 경우 자동으로 GPU 빌드 경로 사용**
    
- 사용자는 별도 작업 없이 설정만 해두면 자동 전환됨
    
- Amazon S3 기반의 중간 저장소(Snapshot repository)를 통해 **비동기 처리 가능**


### 5. **인프라 확장성 확보**

- GPU 인덱스 빌드 서버는 OpenSearch 클러스터와 독립적이므로
    
    - 필요 시 별도 확장 가능
        
    - GPU 서버 비용만 별도로 관리하면 됨 (OpenSearch에 무리 없음)


## 요약

| 항목    | 설명                       |
| ----- | ------------------------ |
| 지원 엔진 | Faiss (HNSW + FP32)      |
| 저장소   | Amazon S3 (중간 저장소 역할)    |
| 성능 향상 | GPU 사용으로 인덱스 속도 대폭 향상    |
| 활용 조건 | 특정 세그먼트 크기 범위 + 지원 구성 사용 |
| API   | Warm-up, Stats API 활용 가능 |
