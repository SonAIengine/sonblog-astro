---
title: OpenSearch Hybrid Search — 키워드와 시맨틱 검색 결합 가이드
description: OpenSearch 2.11의 Hybrid Search 기능을 정리한다. Search Pipeline을 통해 키워드 검색(BM25)과
  Neural Search 결과를 결합하고 normalization/combination processor로 점수를 조정하는 방법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 하이브리드검색
- Search Pipeline
- Neural Search
- BM25
- Search Engine
---


OpenSearch 2.11부터 도입된 **Hybrid Search(하이브리드 검색)** 기능은 키워드 기반 검색과 시맨틱(의미 기반) 검색을 결합하여 보다 정밀하고 유연한 검색 결과를 제공할 수 있게 해줍니다. 이 글에서는 하이브리드 검색의 개념부터 자동화된 설정 방법, 수동 설정 방식까지 전 과정을 상세히 소개합니다.

## 하이브리드 검색이란?

하이브리드 검색은 전통적인 키워드 검색(Query DSL 기반)과 신경망 임베딩을 활용한 의미 기반 검색(Neural Search)의 결과를 결합하여 검색 정확도를 향상시키는 방식이다.

이를 위해 OpenSearch는 **search pipeline**을 통해 쿼리 실행 중간 결과를 가로채고 점수(score)를 조정하거나 재정렬하는 방식으로 동작한다.

### 제공되는 Processor 유형

| Processor 종류            | 도입 버전 | 설명                                          |
| ----------------------- | ----- | ------------------------------------------- |
| Normalization Processor | 2.10  | 여러 쿼리 결과의 점수를 정규화 및 결합 (예: min-max, mean 등) |
| Score Ranker Processor  | 2.19  | 랭크 기반 결과를 결합하는 Rank Fusion 기법 사용            |

## 사전 준비

하이브리드 검색을 사용하려면 먼저 텍스트 임베딩 모델(text embedding model)이 설정되어 있어야 한다.
이미 벡터 임베딩이 생성된 상태라면 바로 검색 파이프라인 구축으로 넘어갈 수 있다.


## 구성 방법

하이브리드 검색 설정은 두 가지 방식으로 구성할 수 있다.

### 1. 자동화 워크플로우 (추천)

OpenSearch에서 제공하는 `hybrid_search` 템플릿을 활용하여 다음을 자동 생성할 수 있다.

- Ingest pipeline (텍스트 임베딩 처리)
    
- Vector index
    
- Search pipeline

~~~json
POST /_plugins/_flow_framework/workflow?use_case=hybrid_search&provision=true
{
  "create_ingest_pipeline.model_id": "모델_ID"
}
~~~

성공 시 반환되는 workflow_id 로 생성 상태를 확인 할 수 있다.

~~~json
GET /_plugins/_flow_framework/workflow/<workflow_id>/_status
~~~

### 2. 수동 구성 (커스터마이징 가능)

#### Step 1. Ingest Pipeline 생성
```json
PUT /_ingest/pipeline/nlp-ingest-pipeline
{
  "description": "텍스트 임베딩 파이프라인",
  "processors": [
    {
      "text_embedding": {
        "model_id": "모델_ID",
        "field_map": {
          "passage_text": "passage_embedding"
        }
      }
    }
  ]
}
```

#### Step 2. Vector Index 생성
```json
PUT /my-nlp-index
{
  "settings": {
    "index.knn": true,
    "default_pipeline": "nlp-ingest-pipeline"
  },
  "mappings": {
    "properties": {
      "id": { "type": "text" },
      "passage_text": { "type": "text" },
      "passage_embedding": {
        "type": "knn_vector",
        "dimension": 768,
        "method": {
          "engine": "lucene",
          "space_type": "l2",
          "name": "hnsw",
          "parameters": {}
        }
      }
    }
  }
}
```

#### Step 3. Search Pipeline 설정
```json
PUT /_search/pipeline/nlp-search-pipeline
{
  "description": "Hybrid Search용 포스트 프로세서",
  "phase_results_processors": [
    {
      "normalization-processor": {
        "normalization": {
          "technique": "min_max"
        },
        "combination": {
          "technique": "arithmetic_mean",
          "parameters": {
            "weights": [0.3, 0.7]
          }
        }
      }
    }
  ]
}
```
`

#### Step 4. 문서 색인
```json
PUT /my-nlp-index/_doc/1
{
  "passage_text": "Hello world",
  "id": "s1"
}

PUT /my-nlp-index/_doc/2
{
  "passage_text": "Hi planet",
  "id": "s2"
}
```

색인 시 ingest pipeline이 실행되어 `passage_embedding` 필드에 벡터가 생성된다.

#### Step 5. Hybrid Search 실행
```json
GET /my-nlp-index/_search?search_pipeline=nlp-search-pipeline
{
  "_source": {
    "exclude": ["passage_embedding"]
  },
  "query": {
    "hybrid": {
      "queries": [
        {
          "match": {
            "passage_text": {
              "query": "Hi world"
            }
          }
        },
        {
          "neural": {
            "passage_embedding": {
              "query_text": "Hi world",
              "model_id": "모델_ID",
              "k": 5
            }
          }
        }
      ]
    }
  }
}
```

다음은 match 쿼리와 neural 쿼리를 결합한 예시이다.
~~~json
GET /my-nlp-index/_search?search_pipeline=nlp-search-pipeline
{
  "_source": {
    "exclude": ["passage_embedding"]
  },
  "query": {
    "hybrid": {
      "queries": [
        {
          "match": {
            "passage_text": {
              "query": "Hi world"
            }
          }
        },
        {
          "neural": {
            "passage_embedding": {
              "query_text": "Hi world",
              "model_id": "모델_ID",
              "k": 5
            }
          }
        }
      ]
    }
  }
}
~~~

결과에는 키워드 기반과 의미 기반 쿼리 모두를 고려한 문서가 반환된다.


## 확장 예시

### Match + Term 쿼리 결합
```json
"query": {
  "hybrid": {
    "queries": [
      { "match": { "passage_text": "hello" } },
      { "term": { "passage_text": { "value": "planet" } } }
    ]
  }
}
```

이 방식으로 다양한 쿼리 유형을 조합할 수 있다.



## 마무리

OpenSearch의 하이브리드 검색 기능은 정보 검색 시스템에서 **정확도 향상**과 **다양한 사용자 질의 대응**을 가능하게 하는 강력한 도구입니다. 키워드 검색만으로는 찾기 어려운 문서도 시맨틱 검색과 결합하여 더 정밀하게 찾아낼 수 있습니다.

