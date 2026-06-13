---
title: “OpenSearch Learning to Rank(LTR) — 머신러닝 기반 검색 랭킹 핵심 개념”
description: “OpenSearch의 Learning to Rank(LTR) 기능의 핵심 개념을 정리한다. Feature Store, 판단
  리스트(Judgment List), RankLib 모델 학습과 배포, 검색 결과 재랭킹까지의 전체 워크플로우를 다룬다.”
pubDatetime: 2025-07-04
tags:
- OpenSearch
- 검색엔진
- LTR
- 머신러닝
- 랭킹
- RankLib
- Search Engine
---


다음은 OpenSearch의 Learning to Rank (LTR)의 핵심 개념을 설명하는 “ML Ranking Core Concepts” 내용을 정리한 것이다.

이 가이드는 OpenSearch에서 머신러닝을 이용해 검색 결과의 관련도를 향상시키고자 하는 개발자 및 데이터 과학자를 위한 기초 개념을 담고 있다.

## 1. LTR이란?

Learning to Rank는 검색 결과를 **사용자 관점에서 더 유의미한 순서로 정렬**하기 위해 머신러닝을 활용하는 기법입니다.  

다른 머신러닝 문제와의 차이점은 다음과 같다.

- **회귀(Regression)**: 수치 예측 (예: 주가 예측)
    
- **분류(Classification)**: 범주 예측 (예: 스팸 여부)
    
- **랭킹(LTR)**: 특정 쿼리에 대해 문서를 **어떤 순서로 정렬해야 가장 유용한가**를 학습
    

LTR의 목적은 "문서가 얼마나 유용한가"를 직접 예측하는 것이 아니라, 
상대적 순서를 예측하는 함수 f(query, document features)를 학습하는 것입니다.


## 2. 정답 순서 정의: Judgment List (골든 셋)

Judgment list는 쿼리와 그에 대한 문서 목록 및 등급(grade)을 포함한 데이터로, "이 쿼리에는 이 문서들이 이런 순서로 나오는 것이 이상적이다"라는 기준을 제공합니다.

예시 (쿼리: Rambo):

```
grade,keywords,movie
4,Rambo,First Blood       → 매우 관련 있음
4,Rambo,Rambo
3,Rambo,Rambo III         → 어느 정도 관련 있음
2,Rambo,Rocky             → 약간 관련 있음
0,Rambo,Bambi             → 전혀 무관
```

이 리스트를 기준으로 모델의 정렬 품질을 **NDCG, ERR** 같은 랭킹 평가 지표로 측정할 수 있습니다.


## 3. 랭킹 모델의 입력: Feature

LTR 모델은 검색 쿼리와 문서 간의 관련도를 판단할 수 있는 피처(특징값)을 입력으로 사용한다.
예를 들어 영화 검색 시스템이라면 다음과 같은 피처가 사용될 수 있다.

- `titleScore`: 제목에 검색어가 얼마나 잘 매칭되는지
    
- `descScore`: 설명에 얼마나 매칭되는지
    
- `popularity`: 영화의 인기도
    
- `rating`: 사용자 평점
    
- `numKeywords`: 검색어 개수
    
- (예: `isSequel`: 속편 여부 등 새로 정의한 특성도 가능)
    

이러한 피처를 이용해 함수 f(titleScore, descScore, popularity, rating, ...) 형태로 결과를 점수화하고, 그 점수를 기반으로 문서를 정렬합니다.


## 4. 학습 데이터 구축: Feature 값 로깅

학습을 위해서는 judgment list에 각 문서의 피처 값이 추가되어야 한다.\
 
예를 들어,

```
grade,keywords,movie,titleScore,descScore,popularity
4,Rambo,First Blood,0.0,21.5,100
4,Rambo,Rambo,42.5,21.5,95
3,Rambo,Rambo III,53.1,40.1,50
```

모델 학습을 위한 대표적인 포맷은 **SVMRank 형식**이며 다음과 같은 구조로 표현된다.

```
4  qid:1  1:0.0  2:21.5  3:100
4  qid:1  1:42.5 2:21.5  3:95
3  qid:1  1:53.1 2:40.1  3:50
```

이 데이터는 로그 기반 자동 수집 또는 수동 주석 방식으로 수집할 수 있다.


## 5. 랭킹 모델 훈련

LTR에서 사용할 수 있는 대표적인 모델은 다음과 같다.

### 트리 기반 모델 (추천)

- LambdaMART, XGBoost 등
    
- 높은 정확도
    
- 학습 및 운영 비용은 큼

### SVM 기반 모델

- SVMRank
    
- 상대적으로 단순하고 가볍지만 정확도는 낮음

### 선형 모델

- 기본 선형 회귀 기반
    
- 대부분의 실제 환경에서는 부정확하므로 권장되지 않음


## 6. 모델 품질 평가 및 일반화

모델의 성능을 올바르게 평가하려면 다음을 고려해야 한다.

- **테스트용 Judgment List 유지**: 학습에 사용되지 않은 데이터를 따로 평가용으로 유지
    
- **Overfitting 방지**: 훈련 데이터에만 잘 맞고 실제 성능이 떨어지는 문제를 피하기 위해 테스트 NDCG 추적
    
- **시간적 일반화(Temporal Generalization)**: 계절성, 이벤트 기반 쿼리에 맞춰 지속적인 테스트 필요



## 7. 실제 시스템에서의 고려사항

- **정확한 judgment list 생성 방법**: 사용자 피드백, 클릭 로그 등 활용

- **품질 측정 지표 선정**: NDCG, Precision@k 등
    
- **데이터 수집 인프라**: 사용자 행동 및 피처 로깅 구조 필요
    
- **모델 재학습 기준**: 성능 저하 감지 시 재훈련 주기 설정
    
- **A/B 테스트 전략**: 기존 시스템과 비교 평가 및 KPI 정의 필요

