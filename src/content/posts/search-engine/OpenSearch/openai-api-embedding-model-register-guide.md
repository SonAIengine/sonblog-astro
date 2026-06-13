---
title: OpenSearch에서 OpenAI API 임베딩 모델 등록 및 사용 가이드
description: OpenSearch에서 OpenAI API 기반 임베딩 모델을 등록하고 인제스트 파이프라인으로 자동 벡터 생성을 구성하는 방법을
  정리한다. connector 생성, 모델 배포, text_embedding processor 설정까지 다룬다.
pubDatetime: 2025-06-29
tags:
- OpenSearch
- 검색엔진
- OpenAI
- 임베딩
- ML Commons
- 인제스트파이프라인
- Search Engine
---



이 가이드는 OpenSearch에서 OpenAI API를 사용하여 임베딩 모델을 등록하고 자동 임베딩 생성을 설정하는 검증된 방법을 설명합니다.

## 사전 준비사항

### 1. OpenSearch 클러스터 설정

```json
PUT _cluster/settings
{
  "persistent": {
    "plugins.ml_commons.only_run_on_ml_node": "false",
    "plugins.ml_commons.model_access_control_enabled": "true",
    "plugins.ml_commons.native_memory_threshold": "99"
  }
}
```

### 2. OpenAI API 키 준비

- OpenAI API 키를 발급받아 준비합니다
- 사용할 임베딩 모델을 결정합니다 (예: text-embedding-3-small, text-embedding-3-large)

## 단계별 설정 (검증된 방법)

### Step 1: OpenAI 커넥터 생성

먼저 OpenAI API와의 연결을 위한 커넥터를 생성합니다. **중요**: `pre_process_function`과 `post_process_function`을 반드시 포함해야 합니다.

```json
POST /_plugins/_ml/connectors/_create
{
  "name": "OpenAI Embedding Connector Fixed",
  "description": "Fixed OpenAI API connector",
  "version": "1.0.0",
  "protocol": "http",
  "parameters": {
    "endpoint": "api.openai.com",
    "model": "text-embedding-3-small"
  },
  "credential": {
    "openAI_key": ""
  },
  "actions": [
    {
      "action_type": "predict",
      "method": "POST",
      "url": "https://api.openai.com/v1/embeddings",
      "headers": {
        "Authorization": "Bearer ${credential.openAI_key}",
        "Content-Type": "application/json"
      },
      "request_body": "{ \"model\": \"${parameters.model}\", \"input\": ${parameters.input} }",
      "pre_process_function": "connector.pre_process.openai.embedding",
      "post_process_function": "connector.post_process.openai.embedding"
    }
  ]
}
```

**응답 예시:**

```json
{
  "connector_id": "tc3IoJcBZGLRABg1c7Qo"
}
```

### Step 2: 모델 등록 및 배포

위에서 생성된 커넥터 ID를 사용하여 모델을 등록합니다:

```json
POST /_plugins/_ml/models/_register?deploy=true
{
  "name": "openai-embedding-fixed",
  "function_name": "remote",
  "connector_id": "tc3IoJcBZGLRABg1c7Qo",
  "description": "Fixed OpenAI embedding model"
}
```

**응답 예시:**

```json
{
  "task_id": "uc3IoJcBZGLRABg13rT2",
  "status": "CREATED",
  "model_id": "us3IoJcBZGLRABg137RI"
}
```

### Step 3: 모델 테스트

모델이 정상적으로 작동하는지 테스트합니다:

```json
POST /_plugins/_ml/models/us3IoJcBZGLRABg137RI/_predict
{
  "parameters": {
    "input": ["테스트 텍스트"]
  }
}
```

성공 시 1536차원의 임베딩 벡터가 반환됩니다.

### Step 4: 인제스트 파이프라인 생성

위에서 생성된 모델 ID를 사용하여 인제스트 파이프라인을 생성합니다:

```json
PUT /_ingest/pipeline/openai-nlp
{
  "description": "OpenAI NLP",
  "processors": [
    {
      "text_embedding": {
        "model_id": "us3IoJcBZGLRABg137RI",
        "field_map": {
          "text": "passage_embedding"
        },
        "description": "Generate embeddings for text field"
      }
    }
  ]
}
```

### Step 5: 벡터 인덱스 생성

**중요**: OpenSearch에서는 `space_type`을 `cosinesimil`로 설정해야 합니다 (`cosine`이 아님):

```json
PUT /my-openai-nlp-index
{
  "settings": {
    "index.knn": true,
    "default_pipeline": "openai-nlp"
  },
  "mappings": {
    "properties": {
      "passage_embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "space_type": "cosinesimil"
      },
      "text": {
        "type": "text"
      },
      "title": {
        "type": "text"
      }
    }
  }
}
```

### Step 6: 문서 인덱싱 및 테스트

이제 문서를 인덱싱하면 자동으로 임베딩이 생성됩니다:

```json
PUT /my-openai-nlp-index/_doc/1
{
  "title": "테스트",
  "text": "간단한 테스트 문서입니다."
}
```

### Step 7: 파이프라인 테스트 (선택사항)

파이프라인이 정상 작동하는지 시뮬레이션으로 확인

```json
POST /_ingest/pipeline/openai-nlp/_simulate
{
  "docs": [
    {
      "_source": {
        "text": "간단한 테스트 문서입니다."
      }
    }
  ]
}
```

### Step 8: 시맨틱 검색 수행

```json
GET /my-openai-nlp-index/_search
{
  "_source": {
    "excludes": ["passage_embedding"]
  },
  "query": {
    "neural": {
      "passage_embedding": {
        "query_text": "AI 기술의 최신 동향",
        "model_id": "us3IoJcBZGLRABg137RI",
        "k": 5
      }
    }
  }
}
```

## 핵심 문제 해결 사항

### 1. 커넥터 설정 시 필수 요소

- `pre_process_function`: `connector.pre_process.openai.embedding`
- `post_process_function`: `connector.post_process.openai.embedding`
- 이 함수들이 없으면 응답 처리 오류가 발생합니다.

### 2. OpenSearch 거리 메트릭

- `cosine` ❌ (오류 발생)
- `cosinesimil` ✅ (올바른 설정)

### 3. 모델 차원 설정

- text-embedding-3-small: **1536차원**
- text-embedding-3-large: **3072차원**
- text-embedding-ada-002: **1536차원**

## 실제 사용 예제

### 다중 문서 인덱싱

```json
PUT /my-openai-nlp-index/_doc/1
{
  "title": "인공지능 기술 동향",
  "text": "2024년 인공지능 기술은 대규모 언어 모델을 중심으로 빠르게 발전하고 있습니다."
}

PUT /my-openai-nlp-index/_doc/2
{
  "title": "머신러닝 응용 분야", 
  "text": "머신러닝은 자연어 처리, 컴퓨터 비전, 추천 시스템 등 다양한 분야에서 활용되고 있습니다."
}

PUT /my-openai-nlp-index/_doc/3
{
  "title": "검색 기술의 진화",
  "text": "시맨틱 검색 기술의 발전으로 사용자의 의도를 더 정확하게 파악할 수 있게 되었습니다."
}
```

## 고급 설정 옵션

### 배치 처리 (`_bulk` API 사용)

```json
POST /my-openai-nlp-index/_bulk?pipeline=openai-nlp
{"index":{"_id":"4"}}
{"title":"AI 연구","text":"최신 AI 연구 동향에 대한 분석입니다."}
{"index":{"_id":"5"}}
{"title":"기술 혁신","text":"기술 혁신이 산업에 미치는 영향을 살펴봅니다."}
```

### 하이브리드 검색 (키워드 + 시맨틱)

```json
GET /my-openai-nlp-index/_search
{
  "_source": {
    "excludes": ["passage_embedding"]
  },
  "query": {
    "hybrid": {
      "queries": [
        {
          "match": {
            "text": "AI 기술"
          }
        },
        {
          "neural": {
            "passage_embedding": {
              "query_text": "AI 기술의 최신 동향",
              "model_id": "us3IoJcBZGLRABg137RI",
              "k": 5
            }
          }
        }
      ]
    }
  }
}
```

## 모니터링 및 디버깅

### 모델 상태 확인

```json
GET /_plugins/_ml/models/us3IoJcBZGLRABg137RI
GET /_plugins/_ml/models/us3IoJcBZGLRABg137RI/_stats
```

### 커넥터 상태 확인

```json
GET /_plugins/_ml/connectors/tc3IoJcBZGLRABg1c7Qo
```

### 파이프라인 테스트

```json
POST /_ingest/pipeline/openai-nlp/_simulate
{
  "docs": [
    {
      "_source": {
        "text": "테스트할 텍스트"
      }
    }
  ]
}
```

## 성능 최적화 및 비용 관리

### OpenAI 모델별 비교

|모델명|차원|최대 토큰|성능|비용|권장 용도|
|---|---|---|---|---|---|
|text-embedding-3-small|1536|8191|높음|낮음|일반적인 용도|
|text-embedding-3-large|3072|8191|최고|높음|고품질 검색|
|text-embedding-ada-002|1536|8191|중간|중간|기본 임베딩|

### 비용 최적화 팁

1. **배치 처리**: 여러 문서를 한 번에 처리하여 API 호출 횟수 최소화
2. **캐싱**: 자주 사용되는 임베딩 결과 캐시
3. **모델 선택**: 용도에 맞는 적절한 모델 선택
4. **텍스트 길이 최적화**: 불필요한 텍스트 제거로 토큰 사용량 절약

## 보안 및 운영 고려사항

### API 키 보안

- 환경 변수 또는 보안 저장소 사용
- 정기적인 API 키 교체
- 최소 권한 원칙 적용

### 모니터링 지표

- API 호출 성공률
- 응답 시간
- 비용 추적
- 오류율 모니터링

## 문제 해결 가이드

### 일반적인 오류와 해결방법

1. **"Unable to find space: cosine" 오류**
    
    - 해결: `space_type`을 `cosinesimil`로 변경
2. **"failed while calling model" 오류**
    
    - 해결: 커넥터에 `pre_process_function`과 `post_process_function` 추가
3. **API 키 인증 오류**
    
    - 해결: OpenAI API 키 유효성 및 잔액 확인
4. **차원 불일치 오류**
    
    - 해결: 인덱스 매핑의 `dimension` 값을 모델 차원과 일치시키기

### 로그 확인 방법

```bash
# OpenSearch 로그 모니터링
tail -f /var/log/opensearch/opensearch.log | grep -i "embedding\|neural\|ml"
```

## 결론

이 가이드를 통해 OpenSearch에서 OpenAI API를 사용한 고품질 시맨틱 검색 시스템을 성공적으로 구축할 수 있습니다. 핵심은 올바른 커넥터 설정(전처리/후처리 함수 포함)과 적절한 거리 메트릭(`cosinesimil`) 사용입니다.

### 검증된 성공 요소

**커넥터**: `pre_process_function`과 `post_process_function` 필수  
**거리 메트릭**: `cosinesimil` 사용 (`cosine` 아님)  
**차원 설정**: text-embedding-3-small = 1536차원  
**모델 테스트**: 파이프라인 적용 전 개별 모델 호출 테스트

이제 OpenAI의 강력한 임베딩 기술을 활용한 고품질 검색 시스템을 운영할 수 있습니다!