---
title: Qdrant GPU 인덱싱 가속 — Docker 이미지와 설정 가이드
description: Qdrant v1.13.0부터 지원하는 GPU 인덱싱 가속 기능을 정리한다. GPU 전용 Docker 이미지 사용법, production.yaml
  gpu 블록 설정, CUDA/Vulkan 디바이스 연동 방법을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- GPU
- Docker
- CUDA
- Search Engine
---


### 1. 개요

Qdrant v1.13.0부터 **GPU 인덱싱 가속**을 공식 지원한다. 

기본 바이너리에는 포함되지 않으므로, 전용 Docker 이미지를 사용하거나 직접 GPU 기능을 켜서 빌드해야 한다.

### 2. 설정 옵션 요약

`production.yaml` 에 다음과 같은 `gpu` 블록이 존재한다.

```yaml
gpu:
  indexing: false          # GPU 인덱싱 사용 여부
  force_half_precision: false
  groups_count: 512        # GPU 워크 그룹 수
  device_filter: ""        # "nvidia" 등 필터 문자열
  devices: null            # 인덱스(0,1…)로 특정 GPU 선택
  parallel_indexes: 1      # 병렬 인덱싱 작업 수
  allow_integrated: false  # 내장 GPU 허용
  allow_emulated: false    # 소프트웨어 GPU(LLVMpipe) 허용
```

> 대부분 기본값을 유지하고 `indexing: true`만 환경 변수로 켜면 된다.


### 3. 독립 실행형 바이너리 빌드

로컬 빌드를 원한다면 GPU 기능을 포함하여 컴파일한다.

```bash
cargo build --release --features gpu
```

- GPU 사용 시 **Vulkan 1.3** 지원이 필수이다.
    
- 실행 시 `gpu.indexing: true`가 설정돼 있어야 실제로 GPU를 쓴다.

### 4. NVIDIA GPU용 Docker

#### 4-1. 사전 준비

- 최신 NVIDIA 드라이버
    
- `nvidia-container-toolkit` 설치

#### 4-2. 실행 예시

```bash
docker run --rm \
  --gpus=all \
  -p 6333:6333 -p 6334:6334 \
  -e QDRANT__GPU__INDEXING=1 \
  qdrant/qdrant:gpu-nvidia-latest
```

- `--gpus=all` → 컨테이너에 물리 GPU 노출
    
- `QDRANT__GPU__INDEXING=1` → Qdrant가 GPU 인덱싱 활성화

#### 4-3. 정상 동작 확인

컨테이너 로그에 다음과 같이 실제 GPU가 잡혔는지 확인한다.

```
INFO gpu::instance: Found GPU device: NVIDIA GeForce RTX 3090
INFO gpu::device:   Create GPU device NVIDIA GeForce RTX 3090
```

#### 4-4. 문제 해결

GPU가 보이지 않으면 다음을 점검한다.

1. 드라이버 및 `nvidia-container-toolkit` 최신화
    
2. `vulkaninfo --summary`로 Vulkan 노출 확인
    
3. `/etc/nvidia-container-runtime/config.toml`에서 `no-cgroups=false` 설정 후 Docker 재시작


### 5. AMD GPU용 Docker

#### 5-1. 사전 준비

- 호스트에 **ROCm** 설치

#### 5-2. 실행 예시

```bash
docker run --rm \
  --device /dev/kfd --device /dev/dri \
  -p 6333:6333 -p 6334:6334 \
  -e QDRANT__GPU__INDEXING=1 \
  qdrant/qdrant:gpu-amd-latest
```

- `/dev/kfd`, `/dev/dri` 장치를 노출해야 ROCm이 인식된다.

#### 5-3. 로그 예시

```
INFO gpu::instance: Found GPU device: AMD Radeon Graphics (RADV GFX1103_R1)
INFO gpu::device:   Create GPU device AMD Radeon Graphics (RADV GFX1103_R1)
```


### 6. 메모리·세그먼트 크기 제한

GPU 한 번의 인덱싱 작업이 처리할 수 있는 데이터는 **16 GB**까지이다.  
세그먼트 크기가 이를 초과하지 않도록 `max_segment_size`(KB 단위) 값을 조정한다.

```http
PATCH /collections/{collection_name}
{
  "optimizers_config": {
    "max_segment_size": 1000000   # 예: 1,000,000 KB ≒ 1 GB
  }
}
```


### 7. 알려진 제약

| 항목     | 내용                                                     |
| ------ | ------------------------------------------------------ |
| 지원 플랫폼 | Linux x86_64 전용 Docker 이미지 제공. Windows, macOS, ARM 미지원 |
| 메모리 한계 | GPU당 16 GB 벡터 데이터/반복 인덱싱                               |


### 8. 한눈에 보는 실행 절차

1. **GPU 드라이버 & 런타임** 설치
    
2. GPU 지원 Docker 이미지(`gpu-nvidia`, `gpu-amd`) 선택
    
3. 컨테이너 실행 시
    
    - GPU 장치 노출(`--gpus=all` 또는 `--device …`)
        
    - `QDRANT__GPU__INDEXING=1` 환경 변수 지정
        
4. 로그로 초기화 성공 확인
    
5. 필요하다면 `max_segment_size`로 세그먼트 조정
    

이렇게 설정하면 Qdrant가 HNSW 그래프 구축을 GPU에서 수행하여 **인덱싱 속도와 배치 처리량이 크게 향상**된다.