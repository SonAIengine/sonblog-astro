---
title: 상품 리뷰 분석 API 개발기 - 형태소 분석기 성능 최적화
description: 상품 리뷰 텍스트 분석의 정확도를 높이기 위한 형태소 분석기 교체 작업. Elasticsearch nori 분석기 전환, 한국어
  NLP 처리 최적화 과정을 정리한다.
pubDatetime: 2024-05-01
tags:
- NLP
- API
- 리뷰분석
- Python
- Elasticsearch
- 형태소분석
- 한국어 NLP
- Nori
- FastAPI
- 텍스트분석
- Portfolio
---

# 상품 리뷰 분석 API 개발기 - 형태소 분석기 성능 최적화

> 2024년 5월, 상품 리뷰 텍스트 분석의 정확도를 높이기 위한 형태소 분석기 교체 작업을 진행했다. Elasticsearch의 기본 분석기에서 한국어 전용 nori 분석기로 변경하며 겪은 과정을 정리한다.

## 배경

기존 상품 리뷰 분석 시스템은 단순한 키워드 매칭 방식을 사용하고 있었다. 하지만 한국어의 특성상 조사, 어미 변화 등으로 인해 동일한 의미의 단어라도 다르게 인식되는 문제가 발생했다. 

예를 들어, "맛있다", "맛있어요", "맛있습니다"가 모두 다른 토큰으로 인식되어 리뷰 감정 분석의 정확도가 떨어지는 상황이었다.

```bash
# 기존 분석기 결과
"이 제품은 정말 맛있어요" → ["이", "제품은", "정말", "맛있어요"]

# nori 분석기 결과 (원하는 결과)
"이 제품은 정말 맛있어요" → ["제품", "정말", "맛있다"]
```

## 기술적 접근

### 1. nori 분석기 도입 결정

Elasticsearch의 nori 분석기는 한국어 형태소 분석을 위해 특별히 설계되었다. 루씬의 Korean 분석기를 기반으로 하며, 다음과 같은 장점이 있다:

- **품사 태깅**: 명사, 형용사, 동사 등을 구분하여 분석
- **활용형 정규화**: "맛있어요", "맛있습니다" → "맛있다"
- **복합어 분해**: "삼성전자" → "삼성", "전자"
- **불용어 처리**: 조사, 어미 등 의미 없는 토큰 제거

### 2. Elasticsearch 인덱스 설정 변경

기존 인덱스를 삭제하고 nori 분석기를 적용한 새로운 인덱스를 생성했다.

```json
{
  "settings": {
    "analysis": {
      "tokenizer": {
        "nori_user_dict_tokenizer": {
          "type": "nori_tokenizer",
          "decompound_mode": "mixed",
          "user_dictionary": "userdict_ko.txt"
        }
      },
      "analyzer": {
        "nori_analyzer": {
          "type": "custom",
          "tokenizer": "nori_user_dict_tokenizer",
          "filter": [
            "lowercase",
            "nori_part_of_speech",
            "nori_readingform"
          ]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "review_text": {
        "type": "text",
        "analyzer": "nori_analyzer"
      }
    }
  }
}
```

### 3. 성능 측정 및 최적화

형태소 분석기 변경 후 성능을 측정해보니 예상대로 처리 시간이 증가했다. 하지만 정확도가 크게 향상되어 전체적인 품질은 개선되었다.

**변경 전/후 비교:**
- 처리 속도: 100ms → 150ms (50% 증가)
- 감정 분석 정확도: 73% → 89% (16%p 향상)
- 키워드 추출 정확도: 68% → 85% (17%p 향상)

## 트러블슈팅

### 1. 사용자 사전 구축

초기에는 브랜드명이나 상품명이 제대로 분석되지 않는 문제가 있었다. "아이폰15"가 "아이", "폰", "15"로 분리되어 의미를 잃는 경우였다.

이를 해결하기 위해 사용자 사전(`userdict_ko.txt`)을 구축했다:

```text
# 브랜드명
아이폰
갤럭시
삼성전자

# 상품 카테고리
스마트폰
노트북
이어폰

# 도메인 특화 용어
가성비
가심비
갓성비
```

### 2. 메모리 사용량 최적화

nori 분석기 도입 후 메모리 사용량이 크게 증가했다. JVM 힙 메모리를 8GB에서 12GB로 증설하고, 불필요한 필터를 제거하여 최적화했다.

```yaml
# elasticsearch.yml
indices.memory.index_buffer_size: 20%
thread_pool.search.size: 4
thread_pool.search.queue_size: 1000
```

### 3. 색인 재구축 자동화

기존 데이터를 새로운 인덱스로 마이그레이션하는 스크립트를 작성했다. 약 200만 건의 리뷰 데이터를 무중단으로 이전하기 위해 별칭(alias)을 활용한 블루-그린 배포 방식을 적용했다.

```python
def reindex_reviews():
    # 새 인덱스 생성
    new_index = f"reviews_nori_{datetime.now().strftime('%Y%m%d')}"
    es.indices.create(index=new_index, body=index_mapping)
    
    # 데이터 마이그레이션
    helpers.reindex(es, 
                   source_index="reviews", 
                   target_index=new_index,
                   chunk_size=1000)
    
    # 별칭 전환
    es.indices.update_aliases({
        "actions": [
            {"remove": {"index": "reviews_*", "alias": "reviews"}},
            {"add": {"index": new_index, "alias": "reviews"}}
        ]
    })
```

## 결과 및 개선사항

형태소 분석기 교체 후 다음과 같은 개선 효과를 확인했다:

1. **감정 분석 정확도 16%p 향상**: 부정적 리뷰와 긍정적 리뷰 구분이 더 정확해짐
2. **키워드 추출 품질 개선**: 의미 있는 명사, 형용사 위주로 추출
3. **검색 품질 향상**: 활용형 정규화로 검색 재현율 증가

특히 "맛없어요", "맛없습니다", "맛없다" 등이 모두 "맛없다"로 정규화되어, 동일한 감정을 표현하는 다양한 표현들을 정확히 분석할 수 있게 되었다.

## 앞으로의 계획

현재는 기본적인 형태소 분석만 적용했지만, 향후 다음과 같은 개선을 계획하고 있다:

- **개체명 인식(NER)**: 브랜드명, 상품명 자동 추출
- **감정 어휘 사전 확장**: 도메인 특화 감정 표현 추가
- **실시간 분석 파이프라인**: 카프카 기반 스트림 처리

한국어 텍스트 분석은 생각보다 복잡하지만, 적절한 도구 선택과 튜닝을 통해 큰 성능 향상을 얻을 수 있다는 것을 확인했다. nori 분석기는 한국어 처리에 특화된 강력한 도구임을 다시 한번 느꼈다.