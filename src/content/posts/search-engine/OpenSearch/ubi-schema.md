---
title: OpenSearch UBI Schema — 사용자 행동 데이터 구조화와 검색 활용
description: OpenSearch의 UBI(Universal Business Insights) 스키마를 정리한다. 클릭, 뷰, 구매 등 사용자
  행동 로그를 정형화하여 검색 품질 개선과 추천 시스템 구축에 활용하는 스키마 구조를 다룬다.
pubDatetime: 2025-07-04
tags:
- OpenSearch
- 검색엔진
- UBI
- 사용자행동
- 스키마
- 추천시스템
- Search Engine
---



# OpenSearch UBI Schema 정리

## 개요

UBI(Universal Business Insights)는 **사용자 행동 데이터를 구조화하고 검색에 활용할 수 있도록 정의된 공통 스키마 체계**입니다. 이 스키마는 사용자 행동 로그(예: 클릭, 뷰, 구매 등)를 정형화하여 OpenSearch 내에서 **개선된 검색 품질과 추천 시스템**을 구축하는 데 도움을 줍니다.

---

## 주요 스키마 카테고리

### 1. Event schema (이벤트 스키마)

사용자 활동 데이터를 정의합니다.

- 필드 예시:
    
    - `event_type`: 이벤트 유형 (click, view, purchase 등)
        
    - `event_timestamp`: 이벤트 발생 시점
        
    - `session_id`: 세션 식별자
        
    - `user_id`: 사용자 식별자
        
    - `item_id`: 클릭/노출된 항목 ID
        

### 2. Item schema (아이템 스키마)

검색/추천 대상이 되는 상품, 문서 등의 항목 정의입니다.

- 필드 예시:
    
    - `item_id`: 항목 고유 ID
        
    - `title`, `description`: 콘텐츠 정보
        
    - `category`, `brand`, `price`: 메타 정보
        
    - `embedding`: 벡터 임베딩 정보
        

### 3. Query schema (검색 질의 스키마)

사용자가 실제 입력한 쿼리 정보입니다.

- 필드 예시:
    
    - `query_id`: 고유 쿼리 ID
        
    - `query_text`: 사용자가 입력한 쿼리
        
    - `query_vector`: 벡터화된 쿼리
        
    - `timestamp`: 입력 시각
        

---

## 왜 사용하는가?

- 사용자 행동 기반 분석 및 모델 학습을 위한 **일관된 데이터 수집 포맷 제공**
    
- 벡터 검색, 클릭 모델, 추천 시스템 등 **고급 검색 기능과의 통합 용이**
    
- OpenSearch Neural Search 및 LTR 등과 연계하여 사용 가능
    

---

## 연동 예

- UBI 스키마 기반으로 로그 데이터를 색인하여,
    
    - Neural Search에서 사용자 질의 기반 벡터 검색 수행
        
    - LTR에서 클릭 로그를 학습 데이터로 활용
        

---

## 요약

|구성 요소|설명|
|---|---|
|Event Schema|사용자 행동(클릭, 구매 등) 정의|
|Item Schema|문서/상품 등의 대상 정의|
|Query Schema|사용자의 검색 질의 정보 정의|
|목적|행동 로그 구조화 → 검색 품질 향상, 모델 학습 지원|

---

해당 스키마는 검색 및 추천 시스템을 구축할 때 **데이터 표준화**를 가능하게 하며, OpenSearch AI 기능과의 통합을 쉽게 해주는 기반 역할을 합니다. 데이터 팀과 검색팀이 공통 포맷으로 협업할 수 있도록 도와주는 구조입니다.