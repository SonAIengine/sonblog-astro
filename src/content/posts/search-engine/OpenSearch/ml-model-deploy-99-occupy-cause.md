---
title: OpenSearch ML 모델 배포 시 메모리 99% 점유 원인과 해결법
description: OpenSearch에 Hugging Face 임베딩 모델을 배포한 후 메모리가 급격히 차오르는 원인을 분석한다. ML Commons
  기반 추론의 모델 크기, JVM 힙, 동시 요청 처리, 노드 역할 분리 등 해결 전략을 정리한다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- 검색엔진
- ML Commons
- 임베딩
- 메모리최적화
- HuggingFace
- Search Engine
---


 Hugging Face embedding 모델을 OpenSearch에 배포(deploy)한 후 메모리가 급격히 차오르거나 꽉 차는 현상은 다음과 같은 이유에서 발생할 수 있다. 
 
 특히 **ML Commons 기반 추론** 또는 `text_embedding` processor를 사용할 때 다음 요소들을 반드시 확인해야 한다.


## 주요 원인 정리

### 1. **모델 자체의 메모리 점유가 큼**

- Hugging Face 모델(`sentence-transformers`, `bert-base`, `all-MiniLM` 등)은 기본적으로 수백 MB ~ 수 GB 크기의 파라미터를 갖는다.
    
- TorchScript나 ONNX 모델은 로드될 때 **전체 모델 가중치가 JVM 힙 또는 native heap에 상주**하게 되며, 일반적으로
    
    - `all-MiniLM-L6-v2`: 약 400MB
        
    - `bert-base-uncased`: 약 1.3GB
        
- **모델 하나당 최소 1~2GB 메모리**가 필요하며, 여러 태스크나 동시 요청이 있으면 급격히 증가함.
    

### 2. **모델이 언로드되지 않고 계속 상주함**

- OpenSearch ML Commons는 모델을 로드하면 언로드(unload)하지 않고 **메모리에 계속 유지**함.
    
- 따라서
    
    - 임베딩 요청이 한 번만 오더라도 → 모델이 메모리에 올라감
        
    - **다시 사용하지 않아도 메모리를 차지한 채로 유지됨**
        
- 이는 `persistent=True` 상태로 서빙되기 때문이다.
    

### 3. **JVM 힙이 아닌 native 메모리를 사용함**

- embedding 처리는 Java 내부 힙이 아닌 **native PyTorch 레벨에서 수행**된다.
    
- 따라서 `OPENSEARCH_JAVA_OPTS=-Xmx4g` 로 제한해도 실제 메모리는 **컨테이너/OS 전체 메모리**를 사용한다.
    

### 4. **추론 태스크 수 증가 / 비동기 쌓임**

- embedding 작업이 batch 또는 비동기로 계속 쌓일 경우, 작업 큐가 비워지지 않으면 **메모리 누적** 현상 발생
    
- 특히:
    
    - `/_predict` API 또는
        
    - ingest pipeline에서 `text_embedding` processor로 문서를 다량 색인할 때
        

### 5. **ML task 설정값 미조정**

- 태스크 제한 없이 많은 양의 ML 요청을 처리하면 **작업별 모델 로딩 + 임시 버퍼**로 인해 OOM 발생 가능


## 확인할 수 있는 지표

1. **실행 중인 ML 태스크**

```bash
GET /_plugins/_ml/tasks
```

2. **로드된 모델 확인**

```bash
GET /_plugins/_ml/models/_all
```

3. **노드 자원 확인**

```bash
GET /_nodes/stats/jvm,os,process
```


## 해결 방법

### (1) ML 전용 노드로 분리

- `node.roles=ml` 전용 노드 구성
    
- `plugins.ml_commons.only_run_on_ml_node=true` 설정
    
- 일반 색인/검색 노드 자원 침해 방지
    

### (2) 모델 task 제한 설정

```yaml
- plugins.ml_commons.max_ml_task_per_node=2
- plugins.ml_commons.native_memory_threshold=85
```

- 동시에 실행할 수 있는 ML 태스크 수를 제한함
    
- 85% 이상 메모리 사용 시 추가 태스크 차단
### (3) 모델 수동 언로드

```bash
POST /_plugins/_ml/models/{model_id}/unload
```

- 사용하지 않는 모델은 수동으로 언로드하여 메모리 확보

### (4) embedding batch 수 제한 (ingest pipeline)

- 대량 문서 색인을 한 번에 하지 않도록 조절
    
- 예: 100~200개 단위로 나누어서 색인


## 요약

|원인|설명|
|---|---|
|모델이 크고 로딩 후 상주|기본적으로 모델은 언로드되지 않음|
|JVM 힙이 아닌 native 메모리 사용|PyTorch가 OS 메모리를 직접 사용함|
|추론 요청 쌓임|ML 태스크 큐가 과부하되면 memory leak처럼 보임|
|태스크 제한 설정 없음|한 노드에서 과도한 ML 요청 처리 중|
