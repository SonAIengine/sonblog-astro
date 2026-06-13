---
title: 아이스크림몰 AI Search 구축 사례
description: 교육전문 쇼핑몰 아이스크림몰에 AI 기반 통합 검색 시스템을 도입한 사례를 정리한다. 초당 5,000건 이상의 검색 트래픽
  대응, 검색엔진 인프라 재구성, AI 모델 최적화 과정을 다룬다.
pubDatetime: 2025-08-04
tags:
- AI Search
- OpenSearch
- 검색엔진
- 이커머스
- 성능최적화
- TPS
- Portfolio
---


## 프로젝트 개요

**아이스크림몰**은 전국 초·중·고등학교 및 유치원을 대상으로 학용품, 실습재료, 교구 등을 공급하는 교육전문 쇼핑몰입니다. 특히 교사들이 예산 범위 내에서 학기별 준비물을 대량으로 구매하는 구조로 인해, 특정 시기(예: 신학기)에 트래픽이 집중되는 경향이 뚜렷합니다.

2025년 1월, 아이스크림몰은 검색 정확도 향상과 검색 경험 개선을 위해 AI 기반 통합 검색 시스템(AI Search)을 도입하였습니다. 도입 직후인 3월에는 하루 최대 검색 요청 초당 처리 수(TPS)가 **5,000건 이상**으로 급증하는 등, 대규모 트래픽 환경에 대응하기 위한 **검색엔진 인프라 재구성 및 AI 모델 최적화**가 필수적이었습니다.

### 도입 배경 및 기술적 필요성

기존의 키워드 중심 검색은 다음과 같은 한계가 있었습니다.

- **검색 실패율이 높고**, 유사한 상품 간 구분이 어려움
- 검색어의 오타, 비정형 표현, 연관어 처리가 어려움
- 고정된 룰 기반 검색 방식으로 **사용자 의도 파악이 제한적**

이에 따라 다음의 기술적 요구사항이 도출되었습니다.

- **텍스트 기반 검색의 정확도 향상**
- **사용자 의도 파악을 위한 의미 기반 검색 기능 강화**
- **LLM 기반 쿼리 확장 및 벡터 연산의 효율적 서빙**
- **수천 TPS 이상을 처리할 수 있는 검색 인프라 구축**

## 기술
### 1. 시스템 구성

**기술 스택**

- 백엔드 프레임워크: `NestJS`
- 검색 엔진: `OpenSearch`
- 텍스트 처리: `Nori Tokenizer` (한국어 분석기), Synonym Expansion
- 검색 방식: `Function Score 기반 Hybrid 검색`, `Nested Query`, `Query DSL`, `LLM 연계 확장 검색 지원`

**검색 인덱스 구조**

- `goods`, `marketing`, `event`, `brand-store` 등 도메인별로 분리된 인덱스 사용
- 검색어 추천용 별도 인덱스 (`*-recomword`, `typo`, `synonym`, `excluding-search-terms`) 운영
- 분석 및 카테고리 추출용 Aggregation 인덱스 구성

### 2. 검색 기능 상세

#### 2.1. 키워드 기반 검색 (Text Retrieval)

- `multi_match`, `query_string`, `term`, `match`, `match_phrase` 등을 조합
- 특수문자 정규화 및 검색어 전처리 (`search.limit` 만큼 토큰 제한)
- 분석기 (`nori_tokenizer`)를 사용하여 형태소 단위 토큰화 후 검색어 재구성
- 검색 필드 및 가중치 (`boost`) 설정은 동적으로 쿼리에 삽입됨

#### 2.2. 의미 기반 확장 검색 (LLM or Synonym 기반)

- 사용자 검색어를 분석 후 `Synonym 인덱스`를 조회하여 **동의어 확장**
- `generateCombinations()` 로 토큰별 조합 생성 → `query_string`에 확장 적용
- `"\"토큰\" OR \"확장어\""` 형태의 query string 구성을 통해 의미 보강

#### 2.3. 함수 기반 랭킹 모델 (function_score)

- 시간 기반 점수 보정: `gauss` 함수로 최신성 반영
- 가격, 할인율 등 정량 필드에 `range` 조건과 함께 `weight` 점수 적용
- 기본 score 외 추가 weight 함수 제공

#### 2.4. 자동 추천어/연관어 시스템

- `getRecomword`, `getIndexRecomword`: 추천어/타이포 정정
- `getPopupWord`, `getPopularSearchWithChangeType`: 실시간 인기 검색어 및 변화량 추적
- `badword` 인덱스를 활용한 필터링 로직 포함

### 3. 고급 검색 기능

#### 3.1. 다단계 Aggregation

- 카테고리 구조 (`대-중-소 카테고리`)를 Nested Multi-Terms Aggregation으로 구성
- 브랜드, 가격 범위, 할인율, 아이콘, 적립 가능 여부 등도 Aggregation으로 수집
- 분석 결과를 기준으로 **추천 필터 제공**

#### 3.2. 재검색 (결과 내 검색)

- `researchWord`를 별도로 처리하여 `filter.bool.should`에 검색 조건 추가
- 기존 검색어와 구분하여 후속 탐색 기능 제공

#### 3.3. 검색어 제외 관리

- `excluding-search-terms` 인덱스를 통해 인기 검색어 중 **노출 제한어 필터링**
- 중복 데이터 감지 및 관리 (`getCheckDuplicateExcludingSearchTerms`)

### 4. 코드 설계 및 구조화 전략

- **Query Template 객체화**: `searchUtilService`에서 쿼리 템플릿을 미리 정의하고 동적으로 조합
- **Field Info 구조화**: 도메인별 검색 필드 및 분석 필드를 별도로 관리 (`attNm`, `Analy`)
    - `setFilterQuery()`는 필터 조건별 DSL을 분기 처리
- **스코어 해석**: `_explanation` 필드에서 점수 산정 근거 추출 (`extractScorePathOnly()`)

## AI 기반 검색 시스템 개발 과정 및 기술적 고민 해결 사례


## 한계&개선점


