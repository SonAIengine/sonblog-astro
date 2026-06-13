---
title: 'Embedding 모델 서빙: batch size 최적화로 긴 문서 처리'
description: XGEN 모델 서버에서 임베딩 모델을 서빙할 때 batch size 512→2048 증가로 긴 문서 임베딩을 지원하고, n_ubatch와
  n_batch 차이, CPU 전용 처리 결정까지의 실전 기록
pubDatetime: 2026-01-30
tags:
- Embedding
- LLM
- batch size
- llama.cpp
- XGEN
- 모델서빙
- AI
---


# Embedding 모델 서빙: batch size 최적화로 긴 문서 처리

임베딩 모델 서빙은 LLM보다 단순해 보이지만 실제로는 다른 문제들이 있다. 문서가 길면 토큰이 많고, 토큰이 많으면 배치 처리가 중요해진다. XGEN에서 임베딩 서버를 안정화하기까지의 과정을 정리한다.

## 문제: 긴 문서 임베딩 실패

초기 설정에서 임베딩 요청이 실패하는 케이스가 있었다. 특히 긴 법률 문서나 기술 문서를 벡터DB에 넣을 때 에러가 발생했다.

원인은 batch size 제한이었다. llama-server의 기본 batch size(`--batch-size`)는 512였고, 긴 문서의 청크가 512 토큰을 초과하면 처리하지 못했다.

```
# 커밋: llamacpp_model batch size 512 -> 2048 증가 (긴 문서 임베딩 지원)
# 날짜: 2026-01-30 04:37

# 커밋: llama-server batch size 512 -> 2048 증가 (긴 문서 임베딩 지원)
# 날짜: 2026-01-30 04:37
```

## n_batch vs n_ubatch

llama-server에는 두 가지 배치 크기 파라미터가 있다.

| 파라미터 | 플래그 | 설명 |
|---------|--------|------|
| `n_batch` | `--batch-size` | 논리적 배치 크기 (최대 입력 토큰 수) |
| `n_ubatch` | `--ubatch-size` | 물리적 배치 크기 (실제 GPU 처리 단위) |

둘 다 2048로 설정했다.

```python
# base.py: ModelLoadRequest 기본값
n_batch: int = Field(
    default=2048,
    description="배치 크기 (llama-server용)"
)
n_ubatch: int = Field(
    default=2048,
    description="물리적 배치 크기 (llama-server용)"
)
```

```python
# llama_server.py: 명령어 생성
cmd = [
    self._binary_path,
    "--model", request.model_path,
    "--batch-size", str(request.n_batch),    # 2048
    "--ubatch-size", str(request.n_ubatch),  # 2048
    ...
]
```

n_ubatch를 별도로 설정할 수 있게 된 건 별도의 커밋에서였다.

```
# 커밋: Add n_ubatch configuration for improved embedding performance
# 날짜: 2026-01-13 09:33
```

## 임베딩 모드 활성화

llama-server는 LLM 모드와 임베딩 모드를 플래그로 구분한다.

```python
# LLM 모드 vs 임베딩 모드 분기
if request.server_type == "llm":
    if request.jinja:
        cmd.append("--jinja")
    if request.cont_batching:
        cmd.append("--cont-batching")

elif request.server_type == "embedding":
    cmd.append("--embedding")   # 임베딩 모드 활성화
    if request.pooling:
        cmd.extend(["--pooling", request.pooling])
```

임베딩 모드에서는 `--embedding` 플래그만 추가하면 된다. `--jinja`나 `--cont-batching`은 LLM 전용이라 넣지 않는다.

```
# 커밋: embedding 모드 지원: config.embedding에 따라 server_type 결정
# 날짜: 2026-01-30 05:15
```

## pooling 설정

임베딩 모델은 pooling 방식이 다르다.

```python
pooling: str = Field(
    default="",
    description="Pooling 방식 (빈 문자열: 모델 기본값 사용)"
)
```

`pooling`을 빈 문자열로 두면 llama-server가 모델 config에서 pooling 방식을 읽어온다. Qwen3-Embedding 같은 모델은 `last` pooling을 사용하는데, 이걸 명시하면 오히려 틀린 결과가 나올 수 있다.

```
# 커밋: llama-server: Flash Attention off, pooling 모델 기본값 사용 (ROCm 안정성)
# 날짜: 2026-01-31 14:20
```

## CPU 전용 처리 결정

```
# 커밋: fix: Embedding은 CPU 전용 (AMD ROCm GPU page fault 회피)
# 날짜: 2026-01-31 12:55
```

결국 임베딩 모델은 GPU를 쓰지 않기로 결정했다. AMD GPU(gfx1151) 환경에서 임베딩 모델에 ROCm을 쓰면 page fault가 발생했기 때문이다.

```python
# 임베딩 모델 로드 시 CPU 전용 설정
ModelLoadRequest(
    model_path="/app/models/Qwen3-Embedding-0.6B.gguf",
    server_type="embedding",
    n_gpu_layers=0,       # CPU 전용 (GPU 레이어 없음)
    n_batch=2048,
    n_ubatch=2048,
    mlock=True,           # RAM 고정
    fit_memory=False,
)
```

임베딩은 LLM에 비해 GPU 메모리를 덜 쓰고, 요청당 처리 시간이 짧다. 소규모 배치는 CPU로도 충분히 처리 가능하다. 안정성이 더 중요한 선택이었다.

## embeddings API 슬롯 분리

```
# 커밋: embeddings API가 embedding 슬롯의 모델을 사용하도록 수정
# 날짜: 2026-01-25 23:28
```

LLM과 임베딩 모델을 동시에 서빙할 때 `/v1/embeddings` 요청이 LLM 슬롯으로 가면 안 된다. 별도 포트의 임베딩 서버로 라우팅해야 한다.

```python
# 모델 로드 시 server_type으로 슬롯 분리
models = {
    "Qwen3-8B":         ModelInfo(port=8001, server_type="llm"),
    "Qwen3-Embedding":  ModelInfo(port=8002, server_type="embedding"),
}

def get_embedding_endpoint(self) -> str | None:
    """임베딩 슬롯의 엔드포인트 반환"""
    for info in self._models.values():
        if info.server_type == "embedding" and info.is_running:
            return info.endpoint
    return None
```

`/v1/embeddings` 요청은 임베딩 슬롯으로, `/v1/chat/completions`는 LLM 슬롯으로 각각 라우팅한다.

## xgen-retrieval의 임베딩 클라이언트

xgen-retrieval(벡터DB 서비스)에서 임베딩을 생성할 때는 별도의 `EmbeddingServiceClient`를 통해 HTTP로 요청한다.

```python
# embedding_service_client.py
class EmbeddingServiceClient(BaseEmbedding):
    def __init__(self, config: Dict[str, Any]):
        base_url = config.get("base_url") or DEFAULT_BASE_URL
        self.timeout = float(config.get("timeout") or 300.0)

    async def _async_request(self, method, endpoint, payload=None):
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.request(method, url, json=payload)
            response.raise_for_status()
            return response.json()
```

타임아웃은 기본 300초다. 긴 문서 배치를 처리할 때 느릴 수 있으므로 넉넉하게 잡았다.

```
# 커밋: feat: Add gzip compression for request payloads in embedding clients
# 날짜: 2026-01-12 19:34
```

페이로드 압축도 추가했다. 긴 문서 배치를 임베딩 서버로 보낼 때 네트워크 비용이 크면 gzip으로 압축해서 전송한다.

## 회고

batch size 2048이 만능은 아니다. GPU 메모리가 작으면 OOM이 날 수 있다. iGPU 환경에서는 1024를 쓰는 게 더 안정적일 수 있다.

임베딩 모델을 CPU로 처리하기로 한 결정은 안정성 측면에서 옳았다. 임베딩의 경우 지연 시간보다 처리량(throughput)이 중요한데, CPU 배치 처리는 충분한 처리량을 제공했다. GPU 크래시로 전체 서버가 죽는 것보다 CPU로 안정적으로 처리하는 게 낫다.
