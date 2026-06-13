---
title: OpenSearch Painless 스크립트로 벡터 유사도 계산하기
description: OpenSearch의 k-NN Painless Scripting Extension을 정리한다. knn_vector 필드에 대해
  L2, cosine similarity, L1 등의 거리 함수를 Painless 스크립트에서 직접 호출하여 커스텀 스코어링을 구현하는 방법을 다룬다.
pubDatetime: 2025-07-11
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- Painless
- 코사인유사도
- 스코어링
- Search Engine
---



OpenSearch는 `knn_vector` 필드에 대해 벡터 거리 계산 함수를 **Painless 스크립트** 내에서 직접 사용할 수 있도록 확장 기능을 제공한다. 

이 기능은 기존의 `knn_score` 스크립트 대신 **보다 유연하고 커스터마이징 가능한 방식**으로 벡터 유사도를 계산할 수 있게 해준다.

## 1. Painless 확장 기능이란?

기본적으로 OpenSearch의 Painless 스크립트는 보안상의 이유로 제한된 함수만 사용할 수 있다. 
하지만 k-NN 플러그인을 통해 다음과 같은 거리/유사도 함수가 추가로 지원된다.

| 함수명                  | 설명                             |
| -------------------- | ------------------------------ |
| `l2Squared()`        | L2 거리(유클리드 거리)의 제곱 계산          |
| `l1Norm()`           | L1 거리(맨해튼 거리) 계산               |
| `cosineSimilarity()` | 코사인 유사도 계산                     |
| `hamming()`          | 해밍 거리 계산 (2.16 이상, binary 필드용) |

## 2. 기본 사용 예시

```json
GET my-knn-index-2/_search
{
  "size": 2,
  "query": {
    "script_score": {
      "query": {
        "bool": {
          "filter": {
            "term": { "color": "BLUE" }
          }
        }
      },
      "script": {
        "source": "1.0 + cosineSimilarity(params.query_value, doc[params.field])",
        "params": {
          "field": "my_vector",
          "query_value": [9.9, 9.9]
        }
      }
    }
  }
}
```

- `field`: `knn_vector` 타입 필드
    
- `query_value`: 쿼리 벡터 (필드와 동일한 차원 필요)
    
- `cosineSimilarity`, `l2Squared`, `l1Norm` 등을 활용해 유사도/거리 계산 가능


## 3. 각 함수 설명

|함수|시그니처|설명|
|---|---|---|
|**`l2Squared`**|`float l2Squared(float[] query, doc['vec'])`|유클리드 거리의 제곱. 값이 작을수록 유사.|
|**`l1Norm`**|`float l1Norm(float[] query, doc['vec'])`|맨해튼 거리.|
|**`cosineSimilarity`**|`float cosineSimilarity(float[] query, doc['vec'])`|코사인 유사도. 일반적으로 0~1 범위.|
|**`cosineSimilarity` (최적화)**|`float cosineSimilarity(query, doc, norm)`|쿼리 벡터의 크기를 별도로 넘겨 반복 계산 방지|
|**`hamming`**|`float hamming(float[] query, doc['vec'])`|해밍 거리. 벡터 값이 정수여야 하며, binary 또는 long 타입 지원 (2.16+)|


## 4. 예외 및 주의사항

- 벡터 차원이 다르면: `IllegalArgumentException` 발생
    
- 벡터 필드가 비어 있으면: `IllegalStateException` 발생  
    → 아래와 같이 size 체크로 회피 가능:
    

```painless
"doc[params.field].size() == 0 ? 0 : 1 / (1 + l2Squared(params.query_value, doc[params.field]))"
```

- **코사인 유사도는 0 벡터 사용 금지**  
    → 크기가 0인 벡터는 계산 불가 → 예외 발생


## 5. 실전 활용 팁

- **필터 조건이 있는 벡터 검색**에 매우 유용 (`bool` + `script_score` 조합)
    
- 벡터 간 거리를 기반으로 **커스텀 랭킹 계산 로직** 구현 가능
    
- `cosineSimilarity`는 자주 쓰이는 경우 norm 미리 계산하여 속도 개선 가능
    
- 스코어가 `0~1` 범위로 제한되지 않으므로 결과 정규화 필요 시 수식 추가


## 마무리

OpenSearch의 **Painless 스크립팅 확장** 기능은 단순한 벡터 검색을 넘어서 **복잡한 랭킹 로직**, **조건부 벡터 스코어링**, **커스텀 점수 조정** 등의 고급 기능 구현을 가능하게 한다.

Approximate k-NN이나 `knn_score` 기반 스크립트보다 더 높은 유연성이 필요한 경우에 적극 활용할 수 있다.
