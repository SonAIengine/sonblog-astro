---
title: OpenSearch & Dashboards 3.1.0 릴리즈 노트
description: OpenSearch 3.1의 주요 변경사항을 정리한다. GPU 가속 인덱싱 정식 적용, 검색 품질 향상, AI 에이전트 지원,
  Observability 개선 등 성능과 기능 양면의 업그레이드를 다룬다.
pubDatetime: 2025-06-30
tags:
- OpenSearch
- 검색엔진
- 릴리즈노트
- GPU
- AI에이전트
- Observability
- Search Engine
---


OpenSearch 3.1은 성능, 검색 품질, AI 에이전트 지원, Observability, 보안 측면에서 대대적인 업그레이드를 제공합니다.

## 주요 기능 요약

### GPU 가속 인덱싱 (정식 적용)

- 최대 9.3배 빠른 인덱스 빌드 속도, 3.75배 비용 절감
    
- 대규모 벡터 인덱싱에 이상적

### Agent 관리 API 제공

- 모델 ID, 프롬프트 등 설정을 직접 수정 가능
    
- 신규 에이전트 생성 없이 구성 수정 가능

### ML Commons Metrics 통합

- OpenTelemetry 호환 지표 수집 기능
    
- 실시간 및 정기 방식 모두 지원

### Search Relevance Workbench (실험적 도구)

- 다양한 검색 전략 비교 및 튜닝
    
- 사용자 행동 기반 검색 품질 평가 가능

### Lucene HNSW on Faiss

- Faiss 인덱스 위에서 Lucene 그래프 검색 실행 가능
    
- 메모리 효율 향상 및 최대 2배 성능 개선

### Star-tree Index 정식 지원

- 최대 100배 빠른 집계 성능
    
- 다양한 집계 및 쿼리 유형 지원


## 검색 및 벡터 기능 강화

- 새로운 Semantic Field Type: 모델 ID로 직접 매핑, 임베딩 자동 처리
    
- Hybrid Search 성능 향상: 최대 65% 빠른 응답, 3.5배 처리량 개선
    
- Collapse 지원 추가: 하이브리드 검색에서도 문서 그룹핑 가능

## AI 및 Observability 기능

- OpenSearch Flow 개선: sparse encoder 기반 시맨틱 검색 템플릿 추가
    
- 시계열 예측 모델 내장 (RCF 기반): Alerting과 연동 가능
    
- PPL JSON 함수 추가: 중첩 JSON 처리 간소화
    
- OpenTelemetry 기반 로그/트레이스 연동 강화: Cross-cluster 검색 및 사용자 지정 필드 매핑 지원

## 보안 기능 향상

- 불변 사용자 객체: 직렬화/역직렬화 최소화로 성능 최적화
    
- Tenant 권한 평가 최적화: 멀티테넌시 환경에서 클러스터 성능 향상
    
- 자원 공유 권한 통합 (실험적): 플러그인별 개별 설정 대신 보안 플러그인에서 일괄 처리

## 실험적 기능

- 자원 공유 및 접근 제어 프레임워크 (Anomaly Detection 플러그인 적용 완료)
    
- MCP 도구 업데이트 및 시스템 인덱스 기반 영속화

## 기타 주요 변경 사항

- Lucene BPV 21 인코딩 도입: BKD 인덱스의 docId 저장 최적화
    
- Workload 자동 태깅: 요청 헤더 없이도 리소스 자동 분배
    
- PPL 20개 이상의 신규 함수 및 명령어 추가
    
- Dashboards 및 Assistant 사용성 개선 다수 포함


이 외에도 다수의 버그 수정, 보안 개선, 테스트 안정화, 문서 보완, 내부 구조 리팩토링 등이 포함되어 있습니다. 다음 릴리즈(3.1.1 또는 3.2)에서는 더욱 향상된 GPU 활용, 벡터 검색, AI 기반 시맨틱 검색 기능이 기대됩니다.