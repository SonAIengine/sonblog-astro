---
title: vLLM + llama.cpp GPU 모델 서빙 최적화 실전기
description: 대규모 언어 모델의 효율적인 서빙을 위해 vLLM과 llama.cpp 기반 추론 엔진을 구축한 과정. GPU 리소스 최적화,
  동적 배칭, CUDA 메모리 관리까지 프로덕션 경험을 정리한다.
pubDatetime: 2025-12-01
tags:
- vLLM
- llama.cpp
- GPU
- 모델서빙
- XGEN
- LLM
- 동적배칭
- CUDA
- 성능최적화
- 프로덕션
- AI
---

# XGEN 1.0 GPU 모델 서빙 구현기 - vLLM과 llama.cpp 최적화

> 2025년 12월, XGEN 1.0 플랫폼에서 대규모 언어 모델의 효율적인 서빙을 위해 vLLM과 llama.cpp 기반 추론 엔진을 구축했다. GPU 리소스 최적화부터 동적 배칭까지, 프로덕션 환경에서의 LLM 서빙 경험을 공유한다.

## 모델 서빙의 현실적 문제들

### 기존 Transformers 기반 서빙의 한계

XGEN 1.0 초기 버전에서는 Hugging Face Transformers를 직접 사용했다:

```python
# 기존 방식의 문제점
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

class SimpleModelServer:
    def __init__(self, model_name: str):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        
    def generate(self, prompt: str, max_length: int = 2048):
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_length=max_length,
                do_sample=True,
                temperature=0.7,
                pad_token_id=self.tokenizer.eos_token_id
            )
        
        return self.tokenizer.decode(outputs[0], skip_special_tokens=True)
```

**심각한 문제점들:**

1. **GPU 메모리 낭비**: Llama-7B 모델도 VRAM 14GB+ 사용
2. **배칭 불가**: 동시 요청 처리 시 선형적 지연 증가  
3. **KV 캐시 비효율**: 각 요청마다 새로운 메모리 할당
4. **동적 형태 제한**: 다양한 시퀀스 길이 처리 비효율적

실제 측정 결과:
- **처리량**: 동시 1개 요청만 가능
- **지연시간**: 평균 8-12초 (Llama-13B 기준)
- **GPU 활용률**: 30% 미만 (메모리 바운드)
- **메모리 사용량**: 24GB VRAM에서 16GB+ 사용

## vLLM: 혁신적인 추론 최적화

### PagedAttention으로 메모리 혁명

vLLM의 핵심은 PagedAttention 알고리즘이다:

```python
# vLLM 기반 서버 구축
from vllm import LLM, SamplingParams
from vllm.entrypoints.api_server import APIServer
import asyncio
from typing import List, Dict

class VLLMServer:
    def __init__(
        self,
        model_name: str,
        tensor_parallel_size: int = 1,
        gpu_memory_utilization: float = 0.9,
        max_model_len: int = 4096
    ):
        self.llm = LLM(
            model=model_name,
            tensor_parallel_size=tensor_parallel_size,
            gpu_memory_utilization=gpu_memory_utilization,
            max_model_len=max_model_len,
            trust_remote_code=True,
            # PagedAttention 설정
            block_size=16,  # KV 캐시 블록 크기
            swap_space=8,   # CPU-GPU 스왑 공간 (GB)
            disable_log_stats=False
        )
        
        self.default_sampling_params = SamplingParams(
            temperature=0.7,
            top_p=0.9,
            top_k=50,
            max_tokens=2048,
            repetition_penalty=1.1
        )
    
    async def generate_batch(
        self, 
        prompts: List[str], 
        sampling_params: SamplingParams = None
    ) -> List[str]:
        """동적 배칭으로 여러 요청 동시 처리"""
        
        if sampling_params is None:
            sampling_params = self.default_sampling_params
            
        # vLLM 자동 배칭 및 KV 캐시 최적화
        outputs = self.llm.generate(prompts, sampling_params)
        
        return [output.outputs[0].text for output in outputs]
    
    async def generate_stream(
        self, 
        prompt: str, 
        sampling_params: SamplingParams = None
    ):
        """스트리밍 응답 생성"""
        
        if sampling_params is None:
            sampling_params = self.default_sampling_params
            
        # 스트리밍 모드 활성화
        streaming_params = SamplingParams(
            **sampling_params.to_dict(),
            stream=True
        )
        
        async for output in self.llm.generate_stream([prompt], streaming_params):
            if output.outputs:
                yield output.outputs[0].text

    def get_memory_stats(self) -> Dict:
        """GPU 메모리 사용량 통계"""
        return {
            "gpu_cache_usage": self.llm.llm_engine.cache_config.gpu_memory_utilization,
            "num_blocks": self.llm.llm_engine.cache_config.num_gpu_blocks,
            "block_size": self.llm.llm_engine.cache_config.block_size,
            "allocated_memory_gb": torch.cuda.memory_allocated() / 1024**3,
            "cached_memory_gb": torch.cuda.memory_reserved() / 1024**3
        }
```

### 동적 배칭의 마법

vLLM의 핵심 혁신은 continuous batching이다:

```python
class DynamicBatchManager:
    """vLLM 내부 동적 배칭 로직 (개념적 구현)"""
    
    def __init__(self, max_batch_size: int = 32):
        self.max_batch_size = max_batch_size
        self.running_requests = []
        self.waiting_requests = asyncio.Queue()
        self.scheduler_interval = 0.01  # 10ms
        
    async def schedule_continuously(self):
        """연속적인 요청 스케줄링"""
        
        while True:
            current_time = time.time()
            
            # 1. 완료된 요청 제거
            self.running_requests = [
                req for req in self.running_requests 
                if not req.is_finished()
            ]
            
            # 2. 새로운 요청 추가 (배치 크기 고려)
            available_slots = self.max_batch_size - len(self.running_requests)
            
            for _ in range(available_slots):
                try:
                    new_request = self.waiting_requests.get_nowait()
                    self.running_requests.append(new_request)
                except asyncio.QueueEmpty:
                    break
            
            # 3. 현재 배치 추론 실행
            if self.running_requests:
                await self._process_batch(self.running_requests)
            
            # 4. 다음 스케줄링까지 대기
            await asyncio.sleep(self.scheduler_interval)
    
    async def _process_batch(self, requests: List):
        """배치 추론 처리"""
        
        # KV 캐시 상태 수집
        kv_caches = [req.kv_cache for req in requests]
        input_ids = [req.get_next_tokens() for req in requests]
        
        # 한번의 forward pass로 모든 요청 처리
        logits = await self.model.forward_batch(input_ids, kv_caches)
        
        # 결과를 각 요청에 분배
        for i, request in enumerate(requests):
            next_token = self.sample_token(logits[i], request.sampling_params)
            request.add_token(next_token)
```

### 실제 배포 아키텍처

```yaml
# docker-compose.vllm.yml
version: '3.8'
services:
  vllm-server:
    build:
      context: ./vllm-server
      dockerfile: Dockerfile.gpu
    ports:
      - "8000:8000"
    environment:
      - CUDA_VISIBLE_DEVICES=0,1  # 멀티 GPU
      - VLLM_TENSOR_PARALLEL_SIZE=2
      - VLLM_GPU_MEMORY_UTILIZATION=0.85
      - VLLM_MAX_MODEL_LEN=8192
    volumes:
      - ./models:/models
      - /dev/shm:/dev/shm  # 공유 메모리 최적화
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 2
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx-proxy:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    depends_on:
      - vllm-server

  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin123
    volumes:
      - grafana_data:/var/lib/grafana
```

## llama.cpp: CPU 추론의 혁신

### CPU에서도 빠른 추론이 가능하다고?

GPU가 없는 환경이나 비용 최적화를 위해 llama.cpp도 함께 구축했다:

```python
# llama.cpp Python 바인딩 활용
from llama_cpp import Llama, LlamaGrammar
import asyncio
from concurrent.futures import ThreadPoolExecutor
import ctypes

class LlamaCppServer:
    def __init__(
        self,
        model_path: str,
        n_ctx: int = 4096,
        n_threads: int = None,
        n_gpu_layers: int = 0,  # CPU only일 때 0
        use_mmap: bool = True,
        use_mlock: bool = True
    ):
        # 스레드 수 자동 설정
        if n_threads is None:
            n_threads = min(16, os.cpu_count())
            
        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_threads=n_threads,
            n_gpu_layers=n_gpu_layers,
            use_mmap=use_mmap,
            use_mlock=use_mlock,
            verbose=False,
            # CPU 최적화 옵션
            f16_kv=True,        # KV 캐시 FP16 사용
            logits_all=False,   # 마지막 토큰 logits만 계산
            vocab_only=False,
            n_batch=512,        # 배치 크기
        )
        
        # 스레드 풀 (비동기 처리용)
        self.executor = ThreadPoolExecutor(max_workers=4)
    
    async def generate_async(
        self, 
        prompt: str,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        top_p: float = 0.9,
        grammar: str = None
    ) -> str:
        """비동기 텍스트 생성"""
        
        # Grammar 설정 (JSON, 코드 등 특정 형식 강제)
        llama_grammar = None
        if grammar:
            llama_grammar = LlamaGrammar.from_string(grammar)
        
        # CPU 바운드 작업을 스레드 풀에서 실행
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            self.executor,
            self._generate_sync,
            prompt,
            max_tokens,
            temperature,
            top_p,
            llama_grammar
        )
        
        return result
    
    def _generate_sync(
        self, 
        prompt: str, 
        max_tokens: int,
        temperature: float,
        top_p: float,
        grammar
    ) -> str:
        """동기 텍스트 생성 (내부 헬퍼)"""
        
        response = self.llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            grammar=grammar,
            echo=False,
            stop=["</s>", "[INST]", "[/INST]"]
        )
        
        return response['choices'][0]['text']
    
    def stream_generate(self, prompt: str, **kwargs):
        """스트리밍 생성 (제너레이터)"""
        
        stream = self.llm(
            prompt,
            stream=True,
            **kwargs
        )
        
        for output in stream:
            token = output['choices'][0]['text']
            yield token

    def get_model_info(self) -> dict:
        """모델 정보 조회"""
        return {
            "n_vocab": self.llm.n_vocab(),
            "n_ctx": self.llm.n_ctx(),
            "n_embd": self.llm.n_embd(),
            "n_layer": self.llm.n_layer(),
            "model_size_gb": self._estimate_model_size(),
            "memory_usage_gb": self._get_memory_usage()
        }
    
    def _estimate_model_size(self) -> float:
        """모델 크기 추정"""
        try:
            import os
            return os.path.getsize(self.model_path) / (1024**3)
        except:
            return 0.0
    
    def _get_memory_usage(self) -> float:
        """현재 메모리 사용량"""
        import psutil
        process = psutil.Process()
        return process.memory_info().rss / (1024**3)
```

### 모델 양자화와 최적화

llama.cpp의 강력한 기능 중 하나는 다양한 양자화 옵션이다:

```bash
#!/bin/bash
# 모델 양자화 스크립트

MODEL_NAME="llama-2-7b-chat"
INPUT_DIR="./models/${MODEL_NAME}"
OUTPUT_DIR="./models/${MODEL_NAME}-quantized"

echo "Converting to GGUF format..."
python convert.py ${INPUT_DIR} --outdir ${OUTPUT_DIR} --outtype f16

echo "Quantizing models..."

# Q4_0: 가장 빠름, 약간의 품질 손실
./quantize ${OUTPUT_DIR}/${MODEL_NAME}.gguf ${OUTPUT_DIR}/${MODEL_NAME}-q4_0.gguf q4_0

# Q4_K_M: 품질과 속도의 균형
./quantize ${OUTPUT_DIR}/${MODEL_NAME}.gguf ${OUTPUT_DIR}/${MODEL_NAME}-q4_k_m.gguf q4_k_m

# Q5_K_M: 더 나은 품질
./quantize ${OUTPUT_DIR}/${MODEL_NAME}.gguf ${OUTPUT_DIR}/${MODEL_NAME}-q5_k_m.gguf q5_k_m

# Q8_0: 최고 품질, 상대적으로 느림
./quantize ${OUTPUT_DIR}/${MODEL_NAME}.gguf ${OUTPUT_DIR}/${MODEL_NAME}-q8_0.gguf q8_0

echo "Quantization complete!"

# 모델 벤치마킹
for quant in q4_0 q4_k_m q5_k_m q8_0; do
    echo "Benchmarking ${quant}..."
    ./llama-bench -m ${OUTPUT_DIR}/${MODEL_NAME}-${quant}.gguf -p 128 -n 512
done
```

양자화 비교 결과:

| 양자화 | 크기 | 속도 | 품질 | 메모리 |
|--------|------|------|------|--------|
| FP16 | 13.5GB | 기준 | 100% | 14GB |
| Q8_0 | 7.2GB | 95% | 99% | 8GB |
| Q5_K_M | 5.1GB | 110% | 97% | 6GB |
| Q4_K_M | 4.0GB | 125% | 95% | 5GB |
| Q4_0 | 3.7GB | 140% | 92% | 4.5GB |

## 통합 모델 라우터

vLLM과 llama.cpp를 상황에 따라 선택적으로 사용하는 라우터를 구현했다:

```python
from enum import Enum
from typing import Optional, Union
import asyncio

class ModelBackend(Enum):
    VLLM = "vllm"
    LLAMA_CPP = "llama_cpp"
    AUTO = "auto"

class ModelRouter:
    def __init__(self):
        self.vllm_server = None
        self.llama_cpp_server = None
        self.load_balancer = LoadBalancer()
        
    async def initialize(self):
        """서버 초기화"""
        
        # GPU 사용 가능 여부 확인
        if torch.cuda.is_available():
            self.vllm_server = VLLMServer(
                model_name="microsoft/DialoGPT-medium",
                tensor_parallel_size=torch.cuda.device_count(),
                gpu_memory_utilization=0.85
            )
            
        # CPU 백엔드는 항상 준비
        self.llama_cpp_server = LlamaCppServer(
            model_path="./models/llama-2-7b-chat-q4_k_m.gguf",
            n_threads=16
        )
    
    async def generate(
        self,
        prompt: str,
        backend: ModelBackend = ModelBackend.AUTO,
        **kwargs
    ) -> str:
        """요청에 적합한 백엔드 선택 및 생성"""
        
        selected_backend = self._select_backend(prompt, backend, **kwargs)
        
        if selected_backend == ModelBackend.VLLM and self.vllm_server:
            return await self._generate_vllm(prompt, **kwargs)
        elif selected_backend == ModelBackend.LLAMA_CPP:
            return await self._generate_llama_cpp(prompt, **kwargs)
        else:
            raise ValueError(f"Backend {selected_backend} not available")
    
    def _select_backend(
        self,
        prompt: str,
        backend: ModelBackend,
        **kwargs
    ) -> ModelBackend:
        """백엔드 선택 로직"""
        
        if backend != ModelBackend.AUTO:
            return backend
        
        # 자동 선택 규칙
        prompt_length = len(prompt.split())
        max_tokens = kwargs.get('max_tokens', 1024)
        urgency = kwargs.get('urgency', 'normal')
        
        # GPU 사용 가능하고 긴 생성이 필요한 경우
        if (self.vllm_server and 
            (prompt_length > 100 or max_tokens > 1024)):
            return ModelBackend.VLLM
        
        # 빠른 응답이 필요한 경우
        if urgency == 'high':
            if self.vllm_server:
                current_load = self.load_balancer.get_vllm_load()
                if current_load < 0.7:
                    return ModelBackend.VLLM
            return ModelBackend.LLAMA_CPP
        
        # 기본적으로 GPU 사용 (사용 가능한 경우)
        return ModelBackend.VLLM if self.vllm_server else ModelBackend.LLAMA_CPP
    
    async def _generate_vllm(self, prompt: str, **kwargs) -> str:
        """vLLM 백엔드 생성"""
        sampling_params = SamplingParams(
            temperature=kwargs.get('temperature', 0.7),
            top_p=kwargs.get('top_p', 0.9),
            max_tokens=kwargs.get('max_tokens', 1024)
        )
        
        results = await self.vllm_server.generate_batch([prompt], sampling_params)
        return results[0]
    
    async def _generate_llama_cpp(self, prompt: str, **kwargs) -> str:
        """llama.cpp 백엔드 생성"""
        return await self.llama_cpp_server.generate_async(
            prompt=prompt,
            max_tokens=kwargs.get('max_tokens', 1024),
            temperature=kwargs.get('temperature', 0.7),
            top_p=kwargs.get('top_p', 0.9)
        )

class LoadBalancer:
    """간단한 로드 밸런서"""
    
    def __init__(self):
        self.vllm_requests = 0
        self.llama_cpp_requests = 0
        self.last_reset = time.time()
    
    def get_vllm_load(self) -> float:
        """vLLM 현재 부하율 (0.0 ~ 1.0)"""
        # 실제로는 GPU 메모리, 대기 큐 길이 등을 고려
        return min(self.vllm_requests / 32.0, 1.0)  # 32개 동시 요청 기준
    
    def report_request(self, backend: ModelBackend):
        """요청 카운트 업데이트"""
        if backend == ModelBackend.VLLM:
            self.vllm_requests += 1
        else:
            self.llama_cpp_requests += 1
        
        # 1분마다 카운터 리셋
        if time.time() - self.last_reset > 60:
            self.vllm_requests = 0
            self.llama_cpp_requests = 0
            self.last_reset = time.time()
```

## FastAPI 통합 서비스

```python
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

app = FastAPI(title="XGEN Model Serving API v2.0")

class GenerateRequest(BaseModel):
    prompt: str
    max_tokens: int = 1024
    temperature: float = 0.7
    top_p: float = 0.9
    backend: str = "auto"  # vllm, llama_cpp, auto
    stream: bool = False
    urgency: str = "normal"  # high, normal, low

class GenerateResponse(BaseModel):
    text: str
    backend_used: str
    generation_time: float
    tokens_per_second: float

# 글로벌 모델 라우터
router = ModelRouter()

@app.on_event("startup")
async def startup():
    await router.initialize()
    logger.info("Model servers initialized")

@app.post("/generate", response_model=GenerateResponse)
async def generate_text(request: GenerateRequest):
    start_time = time.time()
    
    try:
        backend_enum = ModelBackend(request.backend)
    except ValueError:
        backend_enum = ModelBackend.AUTO
    
    try:
        result = await router.generate(
            prompt=request.prompt,
            backend=backend_enum,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            urgency=request.urgency
        )
        
        generation_time = time.time() - start_time
        estimated_tokens = len(result.split()) * 1.3  # 대략적 토큰 수
        tokens_per_second = estimated_tokens / generation_time
        
        return GenerateResponse(
            text=result,
            backend_used=router.last_used_backend.value,
            generation_time=generation_time,
            tokens_per_second=tokens_per_second
        )
        
    except Exception as e:
        logger.error(f"Generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate/stream")
async def generate_stream(request: GenerateRequest):
    """스트리밍 응답"""
    
    if not request.stream:
        raise HTTPException(status_code=400, detail="Stream mode required")
    
    async def token_generator():
        try:
            if router.vllm_server and request.backend != "llama_cpp":
                # vLLM 스트리밍
                async for token in router.vllm_server.generate_stream(request.prompt):
                    yield f"data: {json.dumps({'token': token})}\n\n"
            else:
                # llama.cpp 스트리밍
                for token in router.llama_cpp_server.stream_generate(request.prompt):
                    yield f"data: {json.dumps({'token': token})}\n\n"
                    
            yield "data: {\"done\": true}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return StreamingResponse(
        token_generator(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache"}
    )

@app.get("/models/status")
async def get_model_status():
    """모델 서버 상태 조회"""
    
    status = {
        "timestamp": time.time(),
        "backends": {}
    }
    
    if router.vllm_server:
        status["backends"]["vllm"] = {
            "available": True,
            "memory_stats": router.vllm_server.get_memory_stats(),
            "load": router.load_balancer.get_vllm_load()
        }
    else:
        status["backends"]["vllm"] = {"available": False}
    
    if router.llama_cpp_server:
        status["backends"]["llama_cpp"] = {
            "available": True,
            "model_info": router.llama_cpp_server.get_model_info()
        }
    else:
        status["backends"]["llama_cpp"] = {"available": False}
    
    return status

@app.get("/health")
async def health_check():
    """헬스체크 엔드포인트"""
    return {"status": "healthy", "timestamp": time.time()}
```

## 성능 벤치마킹 결과

### 처리량 비교 (동시 요청 수)

```python
# 벤치마크 결과 정리
benchmark_results = {
    "transformers_baseline": {
        "concurrent_requests": 1,
        "tokens_per_second": 12.5,
        "latency_p95_ms": 8500,
        "memory_usage_gb": 16.2
    },
    "vllm_optimized": {
        "concurrent_requests": 32,
        "tokens_per_second": 185.3,
        "latency_p95_ms": 1200,
        "memory_usage_gb": 14.8
    },
    "llama_cpp_cpu": {
        "concurrent_requests": 4,
        "tokens_per_second": 23.7,
        "latency_p95_ms": 3200,
        "memory_usage_gb": 5.1
    }
}
```

### GPU 모델별 성능 (vLLM)

| 모델 | 파라미터 | GPU | 동시 요청 | Tokens/sec | 지연시간(P95) |
|------|----------|-----|-----------|------------|---------------|
| Llama-7B | 7B | A100 40GB | 64 | 245 | 800ms |
| Llama-13B | 13B | A100 40GB | 32 | 189 | 1100ms |
| Llama-70B | 70B | A100 80GB×4 | 16 | 156 | 2300ms |
| CodeLlama-34B | 34B | A100 80GB×2 | 24 | 178 | 1500ms |

### 비용 효율성 분석

```python
# 시간당 비용 계산 (AWS 기준)
cost_analysis = {
    "a100_40gb": {
        "hourly_cost_usd": 4.10,
        "requests_per_hour": 23040,  # vLLM 64 concurrent
        "cost_per_1k_requests": 0.178
    },
    "cpu_32_cores": {
        "hourly_cost_usd": 1.536,
        "requests_per_hour": 2880,   # llama.cpp 4 concurrent
        "cost_per_1k_requests": 0.533
    },
    "optimization_savings": {
        "vs_transformers": "15x 처리량 증가",
        "memory_efficiency": "13% 메모리 절약",
        "cost_per_request": "GPU: 70% 절약, CPU: 40% 절약"
    }
}
```

## 운영 중 학습한 교훈

### 1. 메모리 관리의 중요성

```python
# 메모리 모니터링 및 자동 정리
class MemoryManager:
    def __init__(self, threshold_gb: float = 20.0):
        self.threshold = threshold_gb
        
    async def monitor_memory(self):
        """메모리 사용량 모니터링 및 자동 정리"""
        while True:
            current_usage = torch.cuda.memory_allocated() / (1024**3)
            
            if current_usage > self.threshold:
                logger.warning(f"High memory usage: {current_usage:.1f}GB")
                
                # KV 캐시 정리
                torch.cuda.empty_cache()
                
                # vLLM 내부 캐시 정리 요청
                await self._request_cache_cleanup()
            
            await asyncio.sleep(30)  # 30초마다 체크
    
    async def _request_cache_cleanup(self):
        """vLLM 서버에 캐시 정리 요청"""
        try:
            await asyncio.create_task(
                router.vllm_server.cleanup_finished_requests()
            )
        except Exception as e:
            logger.error(f"Cache cleanup failed: {e}")
```

### 2. 동적 스케일링

```yaml
# Kubernetes HPA 설정
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vllm-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vllm-server
  minReplicas: 1
  maxReplicas: 4
  metrics:
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: gpu_memory_utilization
      target:
        type: AverageValue
        averageValue: "0.85"
```

### 3. 품질 vs 속도 트레이드오프

실제 서비스에서는 응답 품질이 핵심이다:

```python
# 적응적 샘플링 파라미터
class AdaptiveSampling:
    def __init__(self):
        self.quality_modes = {
            "creative": {"temperature": 0.9, "top_p": 0.95, "top_k": 50},
            "balanced": {"temperature": 0.7, "top_p": 0.9, "top_k": 40},
            "precise": {"temperature": 0.3, "top_p": 0.8, "top_k": 20},
            "deterministic": {"temperature": 0.0, "top_p": 1.0, "top_k": 1}
        }
    
    def get_params(self, task_type: str, urgency: str) -> dict:
        """태스크와 긴급도에 따른 샘플링 파라미터 선택"""
        
        if task_type == "code_generation":
            return self.quality_modes["precise"]
        elif task_type == "creative_writing":
            return self.quality_modes["creative"]
        elif urgency == "high":
            return self.quality_modes["deterministic"]
        else:
            return self.quality_modes["balanced"]
```

## 마무리

XGEN 1.0의 모델 서빙 구축을 통해 LLM 운영의 실체를 깊이 이해하게 되었다.

**핵심 깨달음:**

1. **도구 선택의 중요성**: vLLM과 llama.cpp는 각각의 장점이 명확하다
2. **메모리가 모든 것**: GPU 메모리 최적화가 성능의 90%를 결정한다
3. **배칭의 마법**: 동적 배칭 하나로 15배 성능 향상을 달성할 수 있다
4. **모니터링 필수**: 실시간 메트릭 없이는 프로덕션 운영이 불가능하다

특히 vLLM의 PagedAttention은 정말 혁신적이었다. 기존 Transformers 대비 메모리 효율성과 처리량이 극적으로 개선되었고, 이는 실제 사용자 경험으로 바로 연결되었다.

다음 단계로는 멀티모달 모델(이미지+텍스트) 서빙과 엣지 환경에서의 경량화된 추론을 계획하고 있다. LLM 서빙의 여정은 이제 시작일 뿐이다! 🚀

---

*참고: 벤치마크 수치는 특정 하드웨어와 모델 설정에 따른 것이므로, 실제 환경에서는 다를 수 있습니다.*

---

**관련 글**

- [XGEN 1.0 프론트엔드 모델 관리 UI 구현](../../portfolio/ai-service/xgen-1-0-frontend-model-management-ui-impl.md): 이 글에서 다룬 모델 서빙을 프론트엔드에서 관리하는 UI 개발기
- [Admin 모델 서빙 매니저: GPU 현황과 모델 배포 UI](../../full-stack/frontend/admin-model-serving-manager-gpu-status-model-deploy-ui.md): XGEN 2.0에서 다중 백엔드(vLLM/llamacpp/sglang) 지원, GPU 자동 감지, HuggingFace 검색까지 통합한 모델 관리 UI