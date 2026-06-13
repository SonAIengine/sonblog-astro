---
title: 'vLLM 모델 배포: 샘플링 파라미터 튜닝 가이드'
description: xgen-model에서 vLLM과 llama-server 두 백엔드의 핵심 파라미터를 정리하고, GPU 메모리 활용률, 컨텍스트
  길이, 배치 설정이 성능에 미치는 영향을 실전 경험으로 정리
pubDatetime: 2025-12-31
tags:
- vLLM
- llama.cpp
- LLM
- GPU
- 모델서빙
- 성능튜닝
- AI
---


## 배경

XGEN의 모델 서빙 레이어(xgen-model)는 vLLM과 llama-server 두 백엔드를 지원한다. 모델을 배포할 때 어떤 파라미터를 어떻게 설정하느냐에 따라 GPU 메모리 사용량, 처리 속도, 동시 요청 처리 능력이 크게 달라진다.

처음에는 기본값으로 서버를 띄웠다가 OOM이 나거나, 반대로 GPU를 제대로 활용하지 못해서 성능이 낮은 경우가 많았다. 실제 운영하면서 파악한 각 파라미터의 의미와 튜닝 포인트를 정리했다.

```
# 2025-12-31 커밋: Add tool calling support with model-specific configurations
# 2026-01-22 커밋: llama-server와 vLLM 백엔드 런타임 전환 지원
# 2026-01-26 커밋: API prefix 변경: /api/vllm -> /api/inference
```

## 배포 요청 구조

```python
# backend/adapters/base.py

@dataclass
class ModelLoadRequest:
    # 공통
    model_path: str
    server_type: str = "llm"          # "llm" or "embedding"
    backend: str = "auto"             # "vllm", "llama", "auto"

    # vLLM 전용
    gpu_memory_utilization: float = 0.9
    tensor_parallel_size: int = 1
    max_model_len: int = 4096
    max_num_seqs: int = 256
    quantization: Optional[str] = None  # "awq", "gptq", "fp8"
    dtype: str = "auto"                 # "auto", "float16", "bfloat16"
    enable_prefix_caching: bool = True

    # llama-server 전용
    n_ctx: int = 4096
    n_gpu_layers: int = -1            # -1 = 전체 GPU
    n_batch: int = 2048
    n_ubatch: int = 2048
    flash_attn: bool = False          # ROCm에서 기본 off
    cont_batching: bool = True
    mlock: bool = False

    # 공통 생성 파라미터
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    repeat_penalty: float = 1.1
```

## vLLM 파라미터

### gpu_memory_utilization

```python
gpu_memory_utilization: float = 0.9  # GPU 메모리의 90% 사용
```

vLLM은 시작 시 이 비율만큼 GPU 메모리를 미리 할당한다(KV Cache 풀). 0.9로 설정하면 32GB GPU에서 약 28.8GB를 KV Cache로 쓴다.

높을수록 더 많은 요청을 동시 처리할 수 있지만, 다른 프로세스(임베딩 모델, 시스템)가 같은 GPU를 사용한다면 OOM이 발생한다. 단독 사용이면 0.9, GPU를 나눠 쓴다면 0.6~0.7 수준으로 낮춘다.

### tensor_parallel_size

```python
tensor_parallel_size: int = 1  # 단일 GPU
tensor_parallel_size: int = 2  # 2개 GPU에 모델 분산
```

모델이 단일 GPU에 들어가지 않을 때 여러 GPU에 나눠 올리는 설정이다. 70B 모델은 4비트 양자화해도 약 40GB가 필요하기 때문에 32GB GPU 2장이 필요하다.

```python
# backend/adapters/vllm_base.py

def _build_command(self, request: ModelLoadRequest) -> list[str]:
    cmd = [
        "python", "-m", "vllm.entrypoints.openai.api_server",
        "--model", request.model_path,
        "--gpu-memory-utilization", str(request.gpu_memory_utilization),
        "--tensor-parallel-size", str(request.tensor_parallel_size),
        "--max-model-len", str(request.max_model_len),
        "--max-num-seqs", str(request.max_num_seqs),
    ]

    if request.quantization:
        cmd += ["--quantization", request.quantization]

    if request.dtype != "auto":
        cmd += ["--dtype", request.dtype]

    if request.enable_prefix_caching:
        cmd += ["--enable-prefix-caching"]

    return cmd
```

### max_model_len

```python
max_model_len: int = 4096  # 최대 컨텍스트 길이
```

KV Cache 크기를 결정한다. 모델이 지원하는 최대 컨텍스트(예: 128K)로 설정하면 KV Cache 메모리가 폭발적으로 늘어난다. 실제 사용 패턴에 맞게 줄이는 게 현실적이다.

8K~16K가 대부분의 RAG 사용 사례를 커버하고, 128K 대신 16K로 설정하면 KV Cache 메모리를 8배 절약한다.

### max_num_seqs

```python
max_num_seqs: int = 256  # 동시 처리 시퀀스 최대 수
```

동시에 처리할 수 있는 요청 수 상한이다. 기본값 256은 충분히 크지만, GPU 메모리가 부족하면 vLLM이 자동으로 줄인다. 로그에서 `Available KV cache blocks: N`을 확인해서 실제 처리 가능 시퀀스 수를 파악할 수 있다.

### quantization

```python
quantization: Optional[str] = None  # "awq", "gptq", "fp8"
```

| 방식 | 특징 |
|------|------|
| AWQ | 4비트, 정확도 손실 최소화, 추천 |
| GPTQ | 4비트, 범용 |
| FP8 | 8비트, H100/A100 최적화 |

70B 모델을 AWQ 4비트로 양자화하면 ~40GB → ~20GB로 절반 이하가 된다. 24GB GPU에서도 가능해진다.

### enable_prefix_caching

```python
enable_prefix_caching: bool = True
```

같은 시스템 프롬프트를 공유하는 요청들의 KV Cache를 재사용한다. RAG 시스템에서는 "당신은 XGEN AI 어시스턴트입니다..." 같은 긴 시스템 프롬프트가 반복되는데, 이 부분의 연산을 건너뛰어 응답 속도가 체감적으로 빨라진다.

## llama-server 파라미터

### n_gpu_layers

```python
n_gpu_layers: int = -1  # -1 = 전체 레이어를 GPU에 올림
n_gpu_layers: int = 0   # CPU 전용
n_gpu_layers: int = 20  # 20개 레이어만 GPU, 나머지는 CPU
```

GPU에 올릴 레이어 수를 직접 지정한다. `-1`은 "전부 GPU"다. GPU 메모리가 부족하면 일부 레이어를 CPU에 남겨두는 방식으로 대형 모델을 돌릴 수 있다.

레이어 수는 모델마다 다르다. Llama-3 8B는 32레이어, 70B는 80레이어다.

```python
# backend/adapters/llama_server.py

def _build_command(self, request: ModelLoadRequest) -> list[str]:
    cmd = [
        "llama-server",
        "--model", request.model_path,
        "--ctx-size", str(request.n_ctx),
        "--n-gpu-layers", str(request.n_gpu_layers),
        "--batch-size", str(request.n_batch),
        "--ubatch-size", str(request.n_ubatch),
        "--port", str(self.port),
        "--host", "0.0.0.0",
    ]

    if request.cont_batching:
        cmd += ["--cont-batching"]

    if not request.flash_attn:
        cmd += ["--no-flash-attn"]

    if request.mlock:
        cmd += ["--mlock"]

    return cmd
```

### n_batch / n_ubatch

```python
n_batch: int = 2048    # 배치 크기 (프롬프트 처리)
n_ubatch: int = 2048   # 물리적 배치 크기
```

`n_batch`는 프롬프트 처리 시 한 번에 처리하는 토큰 수다. 크면 프롬프트 처리가 빠르지만 메모리를 많이 쓴다.

`n_ubatch`는 `n_batch`를 실제 GPU에 올릴 때 나누는 단위다. `n_batch=2048, n_ubatch=512`면 2048개 토큰을 512씩 4번에 나눠 처리한다.

기본값은 512인데, 긴 컨텍스트를 자주 처리한다면 2048로 올리는 게 낫다.

### flash_attn

```python
flash_attn: bool = False  # ROCm(AMD GPU)에서는 기본 off
```

FlashAttention은 어텐션 연산을 메모리 효율적으로 처리하는 기법이다. NVIDIA GPU에서는 성능이 크게 개선되지만, AMD ROCm에서는 불안정할 수 있어서 기본값을 `False`로 설정했다.

AMD GPU 환경에서 `--flash-attn`을 켰다가 크래시가 발생해서 꺼둔 경험이 있었다.

### cont_batching

```python
cont_batching: bool = True  # 연속 배치 처리
```

이전 요청이 완료되기를 기다리지 않고 새 요청을 배치에 추가하는 기능이다. 동시 요청이 여러 개일 때 처리량이 크게 개선된다.

### mlock

```python
mlock: bool = False
```

모델 가중치를 RAM에 잠궈서 스왑 아웃되지 않도록 한다. 모델 로드 후 첫 추론이 느린 경우 활성화하면 일관된 응답 속도를 얻을 수 있다. 단, 해당 메모리는 다른 프로세스가 사용할 수 없게 된다.

## 백엔드 자동 선택

```python
# backend/process_manager.py

def _decide_backend(
    self,
    request: ModelLoadRequest,
    gpu_info: dict,
) -> str:
    if request.backend != "auto":
        return request.backend

    has_gpu = gpu_info.get("has_gpu", False)
    gpu_type = gpu_info.get("gpu_type", "unknown")

    if not has_gpu:
        return "llama"   # CPU 전용은 llama-server

    if gpu_type == "amd":
        return "llama"   # AMD GPU는 llama-server (ROCm)

    if request.server_type == "embedding":
        return "llama"   # 임베딩은 항상 llama-server

    # NVIDIA GPU + LLM = vLLM 우선
    return "vllm"
```

AMD GPU(ROCm)에서는 vLLM 지원이 불완전해서 llama-server를 사용한다. 임베딩 모델도 vLLM보다 llama-server가 안정적이었다.

## 실전 설정 사례

### Llama-3 8B (NVIDIA 24GB)

```python
ModelLoadRequest(
    model_path="/models/llama-3-8b-instruct-q4_k_m.gguf",
    backend="vllm",
    gpu_memory_utilization=0.85,
    max_model_len=8192,
    max_num_seqs=64,
    enable_prefix_caching=True,
)
```

24GB GPU에 0.85 할당 → ~20GB KV Cache. 컨텍스트 8K 기준 동시 요청 60~70개 처리 가능.

### Qwen2.5 72B (AMD 2x 32GB)

```python
ModelLoadRequest(
    model_path="/models/qwen2.5-72b-q4_k_m.gguf",
    backend="llama",
    n_gpu_layers=-1,
    n_ctx=4096,
    n_batch=2048,
    flash_attn=False,   # ROCm 안정성
    cont_batching=True,
)
```

72B Q4 모델은 ~40GB. 32GB GPU 2장에 `n_gpu_layers=-1`로 전체 올림.

### 임베딩 모델 (bge-m3)

```python
ModelLoadRequest(
    model_path="/models/bge-m3-q8_0.gguf",
    server_type="embedding",
    backend="llama",
    n_gpu_layers=-1,
    n_ctx=8192,
    n_batch=2048,
)
```

임베딩은 생성이 없으니 `cont_batching`보다 큰 배치 크기가 중요하다.

## 결과

- `gpu_memory_utilization`로 KV Cache 풀 크기 제어 — 단독/공유 GPU에 따라 조정
- `max_model_len` 축소로 실제 사용 컨텍스트에 맞게 메모리 최적화
- `enable_prefix_caching`으로 반복되는 시스템 프롬프트 연산 제거
- AMD GPU에서는 `flash_attn=False`로 안정성 확보
- 백엔드 자동 선택 로직으로 GPU 환경에 맞게 vLLM/llama-server 결정

파라미터 튜닝은 한 번 설정하고 끝이 아니다. 모델 크기, GPU 사양, 동시 사용자 수, 컨텍스트 길이 분포에 따라 최적값이 달라진다. 로그에서 `KV Cache blocks`, `Throughput`, OOM 에러를 모니터링하면서 조정하는 과정이 필요하다.
