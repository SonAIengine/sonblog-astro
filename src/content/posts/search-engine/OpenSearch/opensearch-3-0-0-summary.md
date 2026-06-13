---
title: OpenSearch 3.0.0 릴리즈 하이라이트 – 성능, 벡터 검색, 보안, AI 기능 대폭 강화
description: OpenSearch 3.0은 검색, 분석, 모니터링 및 AI 기반 애플리케이션을 위한 고성능 데이터 플랫폼으로 거듭났습니다.
  이 버전에서는 범용 성능 향상, 벡터 데이터베이스 기능 개선, 보안 프레임워크 교체, AI 연동성 강화 등 다양한 영역에 걸쳐 대규모 개선이 이루어졌습니다.
pubDatetime: 2025-06-30
tags:
- OpenSearch
- 검색엔진
- 벡터검색
- 릴리즈노트
- 보안
- AI
- Search Engine
---


OpenSearch 3.0은 검색, 분석, 모니터링 및 AI 기반 애플리케이션을 위한 고성능 데이터 플랫폼으로 거듭났습니다. 이 버전에서는 범용 성능 향상, 벡터 데이터베이스 기능 개선, 보안 프레임워크 교체, AI 연동성 강화 등 다양한 영역에 걸쳐 대규모 개선이 이루어졌습니다.


## 주요 기능 요약

### 성능 향상

- **Range Query 성능 향상**  
    숫자 및 날짜 필드에 최적화 전략 적용 → 최대 25% 성능 향상 (Big5 벤치마크 기준)
    
- **고카디널리티 쿼리 최적화**  
    cardinality aggregation에 실행 힌트 추가 → p90 쿼리 지연 75% 감소
    
- **k-NN 동시 세그먼트 검색 기본 활성화**  
    → 최대 2.5배 빠른 벡터 검색
    
- **Cold Start 개선**  
    k-NN 벡터에 대한 derived source 도입 → 최대 30배 빠른 쿼리 응답, 3배 저장 공간 절감
    
- **Star-tree Index 기능 확장**  
    metric aggregation과 filter 지원 → 최대 100배의 쿼리 작업량 감소
    
- **Date Histogram 최적화**  
    filter rewrite 성능 향상으로 multi-level 집계에도 대응
    

---

### AI 및 시맨틱 검색 기능

- **Semantic Sentence Highlighting**  
    의미 기반 문장 강조 기능 → 검색 결과에 연관 문장을 자동 하이라이팅
    
- **Z-score 정규화 & 최소값 기반 정규화**  
    하이브리드 검색에서 outlier를 정규화하여 더 안정적인 점수 계산
    
- **Neural Search 개선**  
    embedding 최적화, inner_hits 지원, sparse encoding 개선 등
    
- **MCP (Model Context Protocol) 연동 실험적 도입**  
    외부 AI 에이전트(예: OpenAI, LangChain 등)와의 연동 가능
    

---

### OpenSearch Dashboards 개선

- **Query Insights**  
    실시간 live query API, verbose mode, 동적 컬럼 제공
    
- **PPL (Piped Processing Language)**  
    lookup, join, subsearch 명령어 추가 → 로그 상관 분석 향상
    
- **Observability 개선**  
    Anomaly Detection에서 Discover와 연동해 이상 탐지 시 바로 로그 확인 가능
    

---

### 보안 기능 대폭 개선

- **Java Security Manager 제거 → Java Agent 기반 보안 프레임워크 도입**
    
    - 특권 액션 호출 감지 및 검증
        
    - 동일한 정책 파일 방식 사용
        
- **Privilege 평가 최적화**
    
    - 보안 클러스터 성능 향상
        
    - 직렬화 비용 감소
        
- **PGP 키 갱신 (유효: 2027년 3월 6일까지)**
    

---

### 데이터 관리 및 인덱싱

- **Remote Store 분리 처리**  
    인덱싱 트래픽과 검색 트래픽 분리 가능 → 독립적 스케일링 및 장애 격리
    
- **_scale API 도입**  
    write-once-read-many 패턴에서 index를 read-only 상태로 전환 가능
    
- **노드 수준 Circuit Breaker 설정**  
    k-NN 환경에서 하드웨어 별 메모리 한계 맞춤 설정 지원
    

## 실험적 기능 (Experimental)

- **GPU 가속 벡터 인덱싱/검색**  
    최대 9.3배 빠른 인덱싱, 3.75배 비용 절감
    
- **gRPC + protobuf 전송 프로토콜**  
    JSON 대비 직렬화 비용 감소, 고성능 통신 가능
    
- **Pull-based ingestion**  
    Kafka, Kinesis 등에서 직접 데이터 수신 가능 (역방향 수집)
    
- **계획-실행-반영 Agent (plan-execute-reflect)**  
    문제 해결을 위한 자율 에이전트 프레임워크 도입
    


## 주요 변경 사항 (Breaking Changes)

- **Lucene 10.1 업그레이드**
    
- **JDK 21 이상 필수**
    
- **Security Manager 제거 → Java Agent 대체**
    
- **Bulk API에서 _id 길이 제한 (512 bytes)**
    
- **mmap.extensions, transport-nio plugin 제거**
    
- **CamelCase PathHierarchy tokenizer 사용 중단 예정**
    
- **많은 API 및 설정 명칭 변경 또는 제거**

## 지원 중단 및 이전 공지

- Ubuntu 20.04 지원 종료 예정 (2025년 4월 이후 EOL)
    
- Amazon Linux 2 지원 종료 예정 (Node.js 18 EOL 대응)
    

## PGP 키 변경 안내

- 새 키: `release@opensearch.org` (OpenSearch 3.0.0 이상)
    
- 기존 키(`opensearch@amazon.com`)는 2.x 릴리즈에만 사용

## 정리

| 영역    | 주요 개선 사항                                    |
| ----- | ------------------------------------------- |
| 검색 성능 | k-NN, Range Query, Star-tree, Cold Start 개선 |
| AI 통합 | MCP 연동, 시맨틱 하이라이팅, 하이브리드 정규화                |
| 보안    | Java Agent 기반 보안 프레임워크, 권한 처리 최적화           |
| 대시보드  | Query Insights, PPL 강화, Anomaly 로그 연동       |
| 실험 기능 | GPU 가속, gRPC, pull-based ingestion 등        |
