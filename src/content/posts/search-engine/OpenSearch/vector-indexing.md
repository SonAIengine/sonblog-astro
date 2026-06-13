---
title: OpenSearch 벡터 인덱스 생성 가이드 — k-NN 인덱스 설정과 매핑
description: OpenSearch에서 k-NN 벡터 인덱스를 생성하는 기본 절차를 정리한다. knn_vector 필드 매핑, 엔진 선택(NMSLIB,
  Faiss, Lucene), space_type과 dimension 설정 방법을 다룬다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- k-NN
- 인덱스설계
- 매핑
- Search Engine
---


OpenSearch는 벡터 기반의 검색 기능을 지원하며, 이를 위해 k-NN(k-nearest neighbor) 인덱스를 생성할 수 있다. 

벡터 인덱스는 다양한 검색 방식에 따라 약간의 설정 차이는 있지만, 공통된 핵심 요소를 기반으로 구성된다.

## 1. 벡터 인덱스 생성 개요

벡터 인덱스를 생성하기 위해서는 다음과 같은 기본 단계를 따른다.

```json
PUT /test-index
{
  "settings": {
    "index.knn": true
  },
  "mappings": {
    "properties": {
      "my_vector": {
        "type": "knn_vector",
        "dimension": 3,
        "space_type": "l2",
        "mode": "on_disk",
        "method": {
          "name": "hnsw"
        }     
      }
    }
  }
}
```

### 핵심 단계 요약

1. **k-NN 검색 활성화**  
    `index.knn: true` 설정을 통해 인덱스에 k-NN 검색 기능을 활성화한다.
    
2. **벡터 필드 정의**  
    `knn_vector` 타입의 필드를 정의하고, 해당 필드가 벡터 데이터를 저장하도록 설정한다. 기본적으로 float 벡터이며, 저장 최적화를 위해 byte 또는 binary도 선택 가능하다.
    
3. **벡터 차원 지정**  
    `dimension` 속성은 사용되는 벡터의 차원 수와 일치해야 한다.
    
4. **거리 측정 방식 선택 (선택 사항)**  
    `space_type`을 통해 유사도 측정 방식을 선택할 수 있다. 대표적으로 `l2`(유클리디안 거리) 또는 `cosinesimil`이 있다.
    
5. **저장 최적화 모드 지정 (선택 사항)**  
    `mode` 또는 압축 수준을 선택하여 디스크 사용량 및 성능을 조절할 수 있다.
    
6. **색인화 알고리즘 선택 (선택 사항)**  
    `method` 항목을 통해 `hnsw`, `ivf` 등의 색인화 기법을 사용할 수 있다.
    

## 2. 임베딩 처리 방식에 따른 구현 옵션

임베딩 생성 방식에 따라 두 가지 주요 구현 경로가 존재한다.

| 구현 방식          | 벡터 필드 타입     | 파이프라인 | 변환 방식 | 사용 사례             |
| -------------- | ------------ | ----- | ----- | ----------------- |
| 외부에서 생성된 벡터 저장 | `knn_vector` | 필요 없음 | 직접 삽입 | Raw vector search |
| 인덱싱 중 벡터 자동 생성 | `knn_vector` | 필요함   | 자동 생성 | AI 기반 시맨틱 검색      |

### 2-1. 외부에서 생성된 벡터를 저장하는 경우

기존에 생성된 임베딩 벡터를 인덱스에 저장하는 경우 다음과 같이 설정한다.

```json
PUT /my-raw-vector-index
{
  "settings": {
    "index.knn": true
  },
  "mappings": {
    "properties": {
      "my_vector": {
        "type": "knn_vector",
        "dimension": 3
      }
    }
  }
}
```

이 방식은 벡터를 외부에서 생성한 후 OpenSearch에 삽입하는 방식으로, 모델 추론이 필요한 상황에서는 적합하지 않다.

### 2-2. 인덱싱 중 임베딩을 자동 생성하는 경우

OpenSearch의 ingest pipeline을 통해 텍스트를 임베딩으로 자동 변환할 수 있다. 이때 `text_embedding` 프로세서를 사용하며, 다음과 같이 파이프라인을 정의한다.

```json
PUT /_ingest/pipeline/auto-embed-pipeline
{
  "description": "AI search ingest pipeline that automatically converts text to embeddings",
  "processors": [
    {
      "text_embedding": {
        "model_id": "mBGzipQB2gmRjlv_dOoB",
        "field_map": {
          "input_text": "output_embedding"
        }
      }
    }
  ]
}
```

이후 인덱스를 생성할 때 `default_pipeline`을 지정하여 해당 파이프라인을 사용한다. 벡터 필드의 `dimension` 값은 파이프라인에 사용된 모델의 출력 차원과 일치해야 한다.

```json
PUT /my-ai-search-index
{
  "settings": {
    "index.knn": true,
    "default_pipeline": "auto-embed-pipeline"
  },
  "mappings": {
    "properties": {
      "input_text": {
        "type": "text"
      },
      "output_embedding": {
        "type": "knn_vector",
        "dimension": 768
      }
    }
  }
}
```

이 방식은 벡터 전처리 과정을 자동화하고, 검색 품질을 일정 수준 이상으로 유지하는 데 유리하다.

## 3. 희소 벡터(sparse vector) 지원

OpenSearch는 `dense` 벡터뿐 아니라 `sparse` 벡터도 지원한다. 희소 벡터는 Neural Sparse Search에 사용되며, 메모리 절약 및 효율적인 검색 방식으로 활용될 수 있다.

관련 내용은 [Neural sparse search 공식 문서](https://opensearch.org/docs/latest/search-plugins/neural-search/sparse-search/)를 참고하면 된다.

## 4. 참고 자료 및 다음 단계

- [Preparing vectors](https://opensearch.org/docs/latest/search-plugins/knn/prepare/)
    
- [k-NN vector 필드 설명](https://opensearch.org/docs/latest/search-plugins/knn/index/)
    
- [Methods and engines](https://opensearch.org/docs/latest/search-plugins/knn/methods/)
    

벡터 인덱스 생성 이후에는 실제 데이터를 인덱싱하고 검색을 수행하는 단계로 이어지며, 벡터 인덱스의 설계는 검색 정확도와 성능에 결정적인 영향을 준다. 따라서 용도에 따라 적절한 설정을 선택하는 것이 중요하다.


아래는 `goodsNM` 필드를 대상으로 Hugging Face 임베딩 모델을 활용해 벡터를 자동 생성하여 저장하는 과정을 설명한 기술 블로그 글이다. Rust 코드 예시와 함께, OpenSearch 설정 및 컴퓨팅 자원 요구 사항에 대한 내용도 포함하였다.


## Rust와 OpenSearch를 활용한 자동 벡터 임베딩 처리 구성

OpenSearch의 Ingest Pipeline 기능을 활용하면 `goodsNM` 상품명 필드를 기반으로 벡터를 자동 생성하여 `goods_vector` 필드에 저장할 수 있다. 본 글에서는 Hugging Face 사전 학습 임베딩 모델을 OpenSearch ML Commons에 등록하고, 필요한 클러스터 설정 및 노드 요구 사양까지 포함해 설명한다.

### 1. Hugging Face 임베딩 모델 준비

OpenSearch는 Hugging Face의 Text Embedding 모델을 지원하며, 사전 학습된 모델(예: all‑MiniLM‑L6‑v2, 384 차원)을 TorchScript 또는 ONNX 형식으로 업로드하여 사용할 수 있다 ([OpenSearch](https://opensearch.org/docs/2.5/ml-commons-plugin/model-serving-framework/?utm_source=chatgpt.com "Model-serving framework - OpenSearch Documentation"), [OpenSearch](https://opensearch.org/docs/latest/ml-commons-plugin/pretrained-models/?utm_source=chatgpt.com "OpenSearch-provided pretrained models")).

먼저 TorchScript로 변환하여 Zip 파일로 압축한 후 체크섬을 계산한다.

```bash
torch.jit.script(model).save("model.ts")
zip model.zip model.ts
sha256sum model.zip
```

### 모델 등록 예시

```json
POST /_plugins/_ml/models/_register
{
  "name": "all-MiniLM-L6-v2",
  "version": "1.0.0",
  "model_format": "TORCH_SCRIPT",
  "model_config": {
    "model_type": "bert",
    "embedding_dimension": 384,
    "framework_type": "sentence_transformers"
  },
  "url": "https://my-bucket/model.zip"
}
```

`embedding_dimension` 값은 사용하는 모델 차원과 일치해야 한다 ([OpenSearch Documentation](https://opensearch.isharkfly.com/ml-commons-plugin/api/model-apis/register-model/?utm_source=chatgpt.com "Register model - OpenSearch Documentation")).

## 2. 클러스터 설정 및 ML 노드 구성

인덱싱 과정에서 임베딩을 자동 생성하려면 ML Commons 관련 설정을 조정해야 한다.

```json
PUT _cluster/settings
{
  "persistent": {
    "plugins.ml_commons.allow_registering_model_via_url": "true",
    "plugins.ml_commons.only_run_on_ml_node": "false",
    "plugins.ml_commons.native_memory_threshold": "99"
  }
}
```

GPU 가속이 가능한 ML 노드를 구성하면 추론 성능을 크게 향상할 수 있다. NVIDIA CUDA 11.6 또는 AWS Inferentia 등이 지원된다 ([OpenSearch](https://opensearch.org/docs/2.5/ml-commons-plugin/model-serving-framework/?utm_source=chatgpt.com "Model-serving framework - OpenSearch Documentation"), [OpenSearch Docs](https://docs.opensearch.org/docs/latest/ml-commons-plugin/gpu-acceleration/?utm_source=chatgpt.com "GPU acceleration - OpenSearch Documentation")).

노드 메모리 용량은 모델 파일(수백 MB) 및 배치 추론 시점 메모리 사용량을 고려해 충분히 확보해야 한다 .

## 3. Ingest Pipeline 설정

`goodsNM` 텍스트를 자동으로 임베딩해 `goods_vector`에 저장하도록 파이프라인을 정의한다.

```json
PUT /_ingest/pipeline/goods-embed-pipeline
{
  "description": "Auto-generate embedding for goodsNM",
  "processors": [
    {
      "text_embedding": {
        "model_id": "all-MiniLM-L6-v2",
        "field_map": {
          "goodsNM": "goods_vector"
        }
      }
    }
  ]
}
```

## 4. 벡터 인덱스 생성

벡터 필드를 포함하도록 인덱스를 생성하고 파이프라인을 기본값으로 지정한다.

```json
PUT /goods-index
{
  "settings": {
    "index.knn": true,
    "default_pipeline": "goods-embed-pipeline"
  },
  "mappings": {
    "properties": {
      "goodsNM": { "type": "text" },
      "goods_vector": { "type": "knn_vector", "dimension": 384, "method": { "name": "hnsw", "space_type": "cosinesimil" } }
    }
  }
}
```

## 5. Rust 코드로 문서 색인하기

Rust에서 `goodsNM`만 포함한 객체를 색인하면 자동으로 `goods_vector` 필드가 채워진다.

```rust
use reqwest::Client;
use serde::Serialize;

#[derive(Serialize)]
struct GoodsDoc {
    goodsNM: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    let doc = GoodsDoc { goodsNM: "삼성 갤럭시 노트10".to_string() };

    let res = client
        .post("http://localhost:9200/goods-index/_doc?refresh=true")
        .json(&doc)
        .send()
        .await?;

    println!("Status: {}", res.status());
    println!("Body: {}", res.text().await?);
    Ok(())
}
```

문서 조회 시 `goods_vector` 필드가 벡터 값으로 저장된 것을 확인할 수 있다.

## 6. 컴퓨팅 자원 및 성능 고려사항

- **CPU-only 구성**: 소규모 데이터 처리용으로 가능하나, 임베딩 처리량이 낮고 응답 시간이 느릴 수 있다. dense 모드에서는 수백 ms 정도 소요될 수 있음.
    
- **GPU 구성**: CUDA‑enabled NVIDIA 또는 AWS Inferentia ML 노드에서 TorchScript 모델 추론을 가속화 가능 ([eliatra.com](https://eliatra.com/blog/vector-and-hybrid-search-with-opensearch-and-the-neural-plugin-pt1/?utm_source=chatgpt.com "Implementing Vector and Hybrid Search with OpenSearch and the ..."), [OpenSearch Docs](https://docs.opensearch.org/docs/latest/ml-commons-plugin/gpu-acceleration/?utm_source=chatgpt.com "GPU acceleration - OpenSearch Documentation")), 대량 색인 시 GPU 구성 권장.
    
- **메모리 요구**: 모델 파일과 병렬 추론을 고려해 ML 노드당 최소 16GB, 권장 32GB 이상 확보.
    
- **스케일링**: 색인량이 증가할 경우 ML 노드를 별도로 분리하여 수평 확장 가능.