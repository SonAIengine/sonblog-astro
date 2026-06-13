---
title: OpenSearch 기반 시맨틱 검색 로직 구현
description: OpenSearch에서 텍스트로 이미지를 검색하는 시맨틱 검색 로직을 정리한다. 벡터 임베딩 기반 유사도 검색과 전통적 키워드
  검색을 결합한 하이브리드 검색 구조를 다룬다.
pubDatetime: 2024-09-17
tags:
- OpenSearch
- 시맨틱검색
- 벡터검색
- 이미지검색
- 이커머스
- Portfolio
---


> [!TIP]
> 💡 이 기술의 핵심은 텍스트로 이미지를 검색할 수 있다는 것

전통적인 이미지 검색은 메타데이터나 파일 이름을 기반으로 하지만,

시맨틱 검색은 이미지 자체의 내용을 이해하고 이를 바탕으로 유사한 이미지를 검색할 수 있는 기능을 말합니다.

일반적으로 이렇게 검색해서 결과를 받으려면, 단순 상품명 뿐만 아니라 상품에 대한 추가 정보를 입력해주어야 할 것이다.

`겨울, 검정색, 데이트룩 등등`

**하지만 이 기능의 핵심은 어떠한 추가 정보를 입력하지 않고도 딱 이미지 하나만을 가지고 텍스트를 검색할 수 있다는 것입니다.**

이미지에 대한 정보(캡션)을 추출할 수 있는 모델을 사용하여 데이터를 확보합니다.

**예시 시맨틱 검색어**

- 밝은 빨간색 미니 원피스
- 어두운 파란색 롱 원피스
- 소매가 없는 노란색 원피스
- 흰색 로우탑 운동화
- 갈색 하이탑 운동화
- 여름에 입기 좋은 통기성 좋은 흰색 티셔츠

- 격식 있는 회색 슬랙스 바지
- 발 편한 여성용 운동화
- 방수 기능이 있느 겨울 부츠
- 골드 컬러의 미니멀한 디자인 귀걸이
- 데일리 룩에 어울리는 실버 팔찌

### 0. 기술 개요

---

1. 캡션 추출
2. 캡션 임베딩 & 검색어 임베딩
3. 관련 상품 제공

### 1. 갭션 추출

---

먼저, 상품을 등록할 때 넣는 상품 이미지로부터 자동으로 갭션을 생성

이는 상품의 주요 내용을 자연어로 표현한 것

예를 들어, 신발사진에서 “빨간 줄무늬가 있는 런닝화 한 켤레” 와 같은 캡션을 생성

> [!IMPORTANT] 영어 캡션
> The image shows a young man standing in front of a building with a sign that reads "Royles". He is wearing a beige button-down shirt and black trousers. He is holding a black jacket in his left hand and has a pair of glasses on his right wrist. He has short black hair and is looking off to the side with a serious expression on his face. The building behind him has a wooden facade and large windows.


> [!IMPORTANT] 한국어 캡션
> 그 이미지는 "Royles"라고 쓰여진 표지판이 있는 건물 앞에 서 있는 젊은 남자를 보여줍니다. 그는 베이지색 버튼다운 셔츠와 검은색 바지를 입고 있습니다. 그는 왼손에 검은색 재킷을 들고 있고 오른쪽 손목에 안경을 쓰고 있습니다. 그는 짧은 검은 머리를 가지고 있고 심각한 표정으로 옆을 내려다보고 있습니다. 그의 뒤에 있는 건물은 나무로 된 정면과 큰 창문을 가지고 있습니다.



### 2. 필요한 정보만 추출

---

위에서 보신 캡션 데이터를 모두 쇼핑몰 데이터로 활용될 경우, 불필요한 데이터가 포함되어 검색 성능을 저하시킬 수 있습니다. 이를 방지하기 위해, 도메인에 맞춘 핵심 키워드만을 추출하고 중요도 순으로 데이터를 저장하는 방식을 채택하였습니다.

이러한 방식은 검색 정확도를 높이고 시스템 성능을 최적화하는 데 도움이 됩니다.

이미지 질의 모델을 통해 필요한 정보만을 추출하는 방법을 사용합니다.

1. **카테고리**: 상품의 종류 (예: 원피스, 운동화, 슬랙스 등)
2. **색상**: 상품의 주요 색상 (예: 빨간색, 파란색, 노란색 등)
3. **성별**: 상품의 대상 성별 (예: 여성용, 남성용)
4. **계절**: 상품이 적합한 계절 (예: 여름옷, 겨울옷 등)

이러한 정보를 자동으로 추출할 수 있도록 AI 모델을 설정하면, 모델은 이미지 안의 상품 정보를 정확하게 반환할 수 있습니다.

추출된 정보를 저장하기 위해 검색엔진 필드를 구성하고, 임베딩 벡터를 생성하여 저장합니다. 이러한 방식으로, 검색 쿼리에 대한 응답 시 임베딩 벡터를 활용하여 높은 정확도의 시맨틱 검색 결과를 제공합니다.

### 3. 검색엔진 랭킹 모델 구현

---

**OpenSearch를 활용한 검색엔진 랭킹 모델 구현**

이미지에서 추출한 정보를 효과적으로 검색하기 위해 OpenSearch를 활용한 시맨틱 검색 기능을 구현합니다. 시맨틱 검색은 단순한 키워드 매칭을 넘어, 검색어와 문서 간의 의미적 유사성을 기반으로 결과를 제공하는 방식입니다. 이를 위해 랭킹 모델을 사용하여 검색 결과의 정확성을 높입니다.

### 3.1 OpenSearch 설정

먼저, OpenSearch 클러스터를 구성합니다.

1. **OpenSearch 클러스터 구성**: 클러스터를 설정하고 필요한 인덱스를 생성합니다.
2. **인덱스 매핑 설정**: 추출된 캡션 정보를 저장할 인덱스의 매핑을 설정합니다. 예를 들어, 'category', 'color', 'gender', 'season' 등의 필드를 포함합니다.

```json
PUT /fashion_items
{
  "mappings": {
    "properties": {
      "goodsNm": { "type": "text" },
      "category": { "type": "dense_vector", "dims": 768 },
      "color": { "type": "dense_vector", "dims": 768 },
      "gender": { "type": "dense_vector", "dims": 768 },
      "season": { "type": "dense_vector", "dims": 768 },
      "embedding": { "type": "dense_vector", "dims": 768 }
    }
  }
}
```

### 3.2 임베딩 벡터 생성 및 저장

이미지 캡션을 통해 추출된 정보를 임베딩 벡터로 변환합니다. 이를 위해 사전 훈련된 모델(BERT, CLIP 등)을 사용하여 캡션을 벡터로 변환합니다. 예를 들어, CLIP 모델을 사용하여 이미지와 텍스트 모두에서 임베딩을 생성할 수 있습니다.

### 3.3 랭킹 모델 적용

검색 요청을 처리하기 위해 사용자의 쿼리를 임베딩 벡터로 변환한 후, OpenSearch의 k-NN 검색 기능을 사용하여 유사한 항목을 찾습니다. 랭킹 모델을 통해 검색 결과의 순위를 정하여, 가장 관련성이 높은 결과를 상위에 노출시킵니다.

1. **사용자 쿼리 임베딩**: 사용자의 텍스트 쿼리를 임베딩 벡터로 변환합니다.
2. **k-NN 검색 수행**: OpenSearch의 k-NN 검색을 통해 유사한 항목을 검색합니다.
3. **랭킹 모델 적용**: 검색 결과에 랭킹 모델을 적용하여 순위를 매깁니다.

```python
query = "밝은 빨간색 미니 원피스"
query_embedding = model.get_text_features(query).squeeze().tolist()

search_query = {
  "query": {
    "bool": {
      "should": [
        {
          "knn": {
            "category": {
              "vector": query_embedding,
              "k": 10
            }
          }
        },
        {
          "knn": {
            "color": {
              "vector": query_embedding,
              "k": 10
            }
          }
        },
        {
          "knn": {
            "gender": {
              "vector": query_embedding,
              "k": 10
            }
          }
        },
        {
          "knn": {
            "season": {
              "vector": query_embedding,
              "k": 10
            }
          }
        },
        {
          "knn": {
            "embedding": {
              "vector": query_embedding,
              "k": 10
            }
          }
        }
      ]
    }
  },
  "rescore": {
    "window_size": 50,
    "query_weight": 0.7,
    "rescore_query_weight": 1.2,
    "rescore_query": {
      "rank_feature": {
        "field": "popularity",
        "factor": 1.2
      }
    }
  }
}

response = opensearch.search(index="fashion_items", body=search_query)

```

### 3.4 검색 결과 제공

검색 결과는 사용자에게 가장 관련성이 높은 항목부터 순서대로 제공됩니다. OpenSearch의 랭킹 모델을 통해 유사성을 기준으로 결과를 정렬하여 제공합니다.

이와 같은 방식으로 OpenSearch와 임베딩 벡터를 활용한 시맨틱 검색을 구현하면, 사용자에게 더욱 정확하고 유의미한 검색 결과를 제공할 수 있습니다. 이를 통해 사용자 경험을 크게 향상시킬 수 있으며, 쇼핑몰에서 원하는 상품을 빠르고 정확하게 찾을 수 있게 됩니다.