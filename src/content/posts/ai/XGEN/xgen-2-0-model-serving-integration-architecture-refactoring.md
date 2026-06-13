---
title: 'vLLM에서 llama.cpp로: LLM 서빙 아키텍처 통합 마이그레이션'
description: vLLM Ray Serve 분산 구조에서 통합 모델 서빙 서비스로 마이그레이션한 과정. 백엔드 스위칭 매니저 설계, llama.cpp와
  vLLM 런타임 전환까지.
pubDatetime: 2026-01-22
tags:
- 모델서빙
- 리팩토링
- vLLM
- XGEN
- llama.cpp
- FastAPI
- 아키텍처
- 마이그레이션
- LLM
- 백엔드스위칭
- AI
featured: true
series: XGEN 개발기
seriesOrder: 4
---

# XGEN 2.0 모델 서빙 통합 아키텍처 리팩토링

> 2026.01 | vLLM Ray Serve에서 통합 xgen-model 서비스로의 마이그레이션

## 배경

XGEN 1.0에서는 GPU 모델 서빙을 위해 vLLM과 Ray Serve를 조합한 분산 처리 아키텍처를 사용했다. 하지만 운영 과정에서 몇 가지 문제점이 드러났다:

- **복잡한 의존성**: Ray Serve 클러스터 관리와 vLLM 엔진 간의 복잡한 연동
- **리소스 오버헤드**: Ray 클러스터 자체가 상당한 메모리와 CPU를 소모
- **배포 복잡성**: Docker 환경과 Kubernetes 간의 서로 다른 설정 관리
- **모니터링 어려움**: 여러 레이어에 걸친 로그와 메트릭 수집의 복잡성

XGEN 2.0에서는 이러한 문제를 해결하기 위해 **xgen-model** 단일 서비스로 통합하는 대규모 리팩토링을 진행했다.

## 아키텍처 변화

### Before: vLLM Ray Serve 구조

```yaml
# 기존 구조
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Gateway   │ -> │   Ray Serve      │ -> │    vLLM Engine  │
│  (Rust/Axum)   │    │   (Distribute)   │    │   (GPU Serve)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### After: xgen-model 통합 구조

```yaml
# 새로운 구조
┌─────────────────┐    ┌──────────────────────────────────┐
│   API Gateway   │ -> │        xgen-model                │
│  (Rust/Axum)   │    │  ┌─────────────┐ ┌─────────────┐ │
└─────────────────┘    │  │  FastAPI    │ │ vLLM Engine │ │
                       │  │  Controller │ │   Direct    │ │
                       │  └─────────────┘ └─────────────┘ │
                       └──────────────────────────────────┘
```

## 핵심 구현 내용

### 1. 서비스 통합 및 컨테이너 변경

가장 먼저 Docker Compose와 Kubernetes 배포 설정에서 vLLM Ray Serve를 제거하고 xgen-model로 교체했다:

```yaml
# services.docker.yaml (Before)
vllm-ray-serve:
  image: vllm/vllm-openai:latest
  environment:
    RAY_SERVE_ENABLE_EXPERIMENTAL_STREAMING: "1"

# services.docker.yaml (After)  
xgen-model:
  image: registry.x2bee.com/xgen-model:latest
  environment:
    MODEL_CONFIG_PATH: "/app/config/models.yaml"
```

이 변경으로 Ray 클러스터 초기화에 필요한 30-45초의 시작 시간이 5-10초로 단축되었다.

### 2. Kubernetes DNS 내부 통신 최적화

기존에는 외부 도메인을 통해 모델 서빙에 접근했지만, K3s 클러스터 내부에서는 Kubernetes DNS를 활용한 직접 통신으로 개선했다:

```yaml
# config.yml (Before)
model_service_url: "https://xgen.x2bee.com/model"

# config.yml (After)
model_service_url: "http://xgen-model.xgen.svc.cluster.local:8000"
```

이 변경으로:
- **레이턴시 개선**: 외부 로드밸런서를 거치지 않아 5-10ms 단축
- **보안 강화**: 클러스터 내부 통신으로 SSL 오버헤드 제거
- **안정성 향상**: 외부 네트워크 의존성 제거

### 3. 추론 모듈 명칭 정리

기존 코드에서 `vllm` 모듈명을 `inference`로 변경하여 구현체에 독립적인 추상화를 구현했다:

```python
# Before
from xgen_backend.services.vllm import ModelService

# After  
from xgen_backend.services.inference import ModelService
```

이는 향후 다른 추론 엔진(TensorRT-LLM, TGI 등)으로의 교체 가능성을 고려한 설계다.

## 성능 및 운영 개선 효과

### 1. 메모리 사용량 최적화

Ray Serve 제거로 인한 메모리 사용량 변화:
- **Before**: 기본 Ray 클러스터 2-3GB + vLLM 엔진 8GB = 10-11GB
- **After**: xgen-model 단일 프로세스 8.5GB

약 **20% 메모리 절약** 효과를 달성했다.

### 2. 시작 시간 단축

컨테이너 시작부터 API 응답 가능까지의 시간:
- **Before**: Ray 클러스터 초기화(30s) + vLLM 로딩(15s) = 45s
- **After**: FastAPI 시작(3s) + vLLM 로딩(12s) = 15s

**3배 빠른** 서비스 시작이 가능해졌다.

### 3. 로그 통합 및 모니터링

이전에는 Ray Serve, vLLM Engine, Gateway가 각각 다른 로그 포맷을 사용했지만, 통합 후에는 단일 FastAPI 로그로 일원화되어 트러블슈팅이 크게 개선되었다.

## 마이그레이션 과정에서의 도전

### 1. GPU 메모리 관리

Ray Serve에서는 워커 프로세스별 GPU 메모리 할당을 자동 관리했지만, 직접 vLLM을 사용할 때는 수동 관리가 필요했다:

```python
# GPU 메모리 사전 할당 및 해제 로직 추가
import torch
torch.cuda.empty_cache()
```

### 2. 동시성 처리

Ray Serve의 자동 스케일링 대신 FastAPI의 비동기 처리와 vLLM의 내장 배치 처리를 활용했다:

```python
# AsyncAPI와 vLLM 배치 처리 조합
@app.post("/v1/completions")
async def completions(request: CompletionRequest):
    return await model_service.generate_async(request)
```

## 결론

XGEN 2.0의 모델 서빙 통합 리팩토링은 단순히 기술 스택을 변경한 것이 아니라, **운영 복잡성을 대폭 줄이고 성능을 개선한 아키텍처 혁신**이었다.

특히 Kubernetes 환경에서의 내부 DNS 활용과 단일 서비스 통합은, 마이크로서비스의 복잡성과 단일 서비스의 단순함 사이에서 적절한 균형점을 찾은 사례로 평가된다.

이러한 변화로 XGEN 2.0는 더욱 안정적이고 빠른 AI 에이전트 플랫폼으로 발전할 수 있는 기반을 마련했다.

---

**주요 키워드**: vLLM, Ray Serve, Kubernetes DNS, 모델 서빙, 아키텍처 리팩토링, FastAPI, GPU 최적화