---
title: 단일 서버에서 OpenSearch 최적 배포 — 노드 역할 분리와 자원 격리
description: 단일 서버에서 Docker Compose로 OpenSearch를 배포할 때 ML 노드 역할 분리와 자원 격리를 구현하는 방법을
  정리한다. 데이터 노드와 ML 전용 노드를 분리하여 벡터 임베딩 기능을 안정적으로 운영하는 전략을 다룬다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- 검색엔진
- Docker Compose
- ML노드
- 자원격리
- 인프라
- Search Engine
---


OpenSearch 클러스터 환경에서 ML(머신러닝) 기반 벡터 임베딩 기능을 안정적으로 제공하려면 **노드 역할 분리**와 **자원 격리 설정**이 필수다. 

본 글에서는 Docker Compose 기반으로 이를 구현하는 최적화된 예시와 함께, 공식 문서 및 실무 팁을 상세히 정리한다.

## 1. 사전 준비

- **Docker 및 Docker Compose 설치** ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/install-and-configure/install-opensearch/docker/?utm_source=chatgpt.com "Docker - OpenSearch Documentation"))
    
- Linux 커널 세팅:  
    `vm.max_map_count=262144`, `swapoff -a`는 필수로, 프로덕션 성능 저하 방지용이다 ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/install-and-configure/install-opensearch/docker/?utm_source=chatgpt.com "Docker - OpenSearch Documentation"))
    
- 컨테이너의 `/dev/shm` 기본 크기는 64 MB이므로, Performance Analyzer를 쓸 경우 `--shm-size=1gb` 설정이 권고된다 ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/monitoring-your-cluster/pa/index/?utm_source=chatgpt.com "Performance Analyzer - OpenSearch Documentation"))


## 2. Docker Compose 예시

```yaml
services:
  opensearch-data:
    image: opensearchproject/opensearch:latest
    container_name: opensearch-data
    environment:
      - cluster.name=opensearch-cluster
      - node.name=opensearch-data
      - node.roles=data,ingest,remote_cluster_client
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx4g
      - discovery.seed_hosts=opensearch-data,opensearch-ml
      - cluster.initial_cluster_manager_nodes=opensearch-data
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    deploy:
      resources:
        limits:
          memory: 6g
          cpus: "2.0"
    ports:
      - 9200:9200
      - 9600:9600
    networks:
      - opensearch-net

  opensearch-ml:
    image: opensearchproject/opensearch:latest
    container_name: opensearch-ml
    environment:
      - cluster.name=opensearch-cluster
      - node.name=opensearch-ml
      - node.roles=ml,remote_cluster_client
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g
      - discovery.seed_hosts=opensearch-data,opensearch-ml
      - cluster.initial_cluster_manager_nodes=opensearch-data
      - plugins.ml_commons.only_run_on_ml_node=true
      - plugins.ml_commons.task_dispatch_policy=least_load
      - plugins.ml_commons.max_ml_task_per_node=2
      - plugins.ml_commons.native_memory_threshold=90
      - plugins.ml_commons.jvm_heap_memory_threshold=85
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    deploy:
      resources:
        limits:
          memory: 4g
          cpus: "1.0"
    networks:
      - opensearch-net

  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:latest
    container_name: opensearch-dashboards
    depends_on:
      - opensearch-data
    environment:
      - OPENSEARCH_HOSTS=["https://opensearch-data:9200"]
      - OPENSEARCH_INITIAL_ADMIN_PASSWORD=ChangeMeStrong
    ports:
      - 5601:5601
    networks:
      - opensearch-net

volumes:
  opensearch-data-vol:

networks:
  opensearch-net:
    driver: bridge
```

---

## 3. 주요 설정 분석

### 3.1 역할 분리 및 JVM 힙 설정

- `opensearch-data`: `data, ingest` 역할로 색인 및 검색 처리, JVM 힙 4GB
    
- `opensearch-ml`: `ml` 역할로 ML 추론 전용, JVM 힙 2GB ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/ml-commons-plugin/cluster-settings/?utm_source=chatgpt.com "ML Commons cluster settings - OpenSearch Documentation"))
    

### 3.2 자원 격리 설정

- Docker `deploy.resources.limits`로 각각 CPU, 메모리 사용량 제한
    
- `bootstrap.memory_lock=true`와 `nofile` 제한으로 스왑 및 파일 디스크립터 이슈 대응 ([OpenSearch](https://forum.opensearch.org/t/opensearch-cold-start/19618?utm_source=chatgpt.com "Opensearch cold start"), [OpenSearch](https://opensearch.org/docs/1.2/opensearch/install/important-settings/?utm_source=chatgpt.com "Important settings - OpenSearch documentation"))
    

### 3.3 ML Commons 설정

- `only_run_on_ml_node=true`: ML 작업을 ML 노드에 국한 ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/ml-commons-plugin/cluster-settings/?utm_source=chatgpt.com "ML Commons cluster settings - OpenSearch Documentation"))
    
- `task_dispatch_policy=least_load`: 부하 상태 기반 태스크 분배
    
- `max_ml_task_per_node=2`, 메모리·힙 threshold 설정으로 안정성 강화 ([OpenSearch Docs](https://docs.opensearch.org/docs/latest/ml-commons-plugin/cluster-settings/?utm_source=chatgpt.com "ML Commons cluster settings - OpenSearch Documentation"))
    

### 3.4 퍼포먼스 분석

- `dev‘/dev/shm` 설정을 위해 추가 설정 필요할 수 있음
    
- `environment`에 `OPENSEARCH_JAVA_OPTS` 로 concurrent-segment-search 플래그 설정 추천 시 추가 가능 ([OpenSearch Docs](https://docs.opensearch.org/docs/2.10/search-plugins/concurrent-segment-search/?utm_source=chatgpt.com "Concurrent segment search - OpenSearch Documentation"))


## 4. 실행 및 확인

1. **커널 설정 확인**:
    
    ```bash
    sudo sysctl -w vm.max_map_count=262144
    sudo swapoff -a
    ```
    
2. **클러스터 실행**:
    
    ```bash
    docker compose up -d
    ```
    
3. **노드 상태 검증**:
    
    - `curl localhost:9200/_cat/nodes?v` 로 데이터·ML 노드 분리 확인
        
    - `curl localhost:9200/_cluster/settings?include_defaults=true` 로 ML 설정 확인
        
4. **ML 태스크 테스트**:  
    예: `/_plugins/_ml/_predict` 호출 시 ML 노드 실행 확인 가능
    

---

## 5. 운영 환경 권장 사항

| 구성 상황      | 권장 방식                   |
| ---------- | ----------------------- |
| 테스트/개발     | 위 구성으로 단일 서버 멀티 노드 가능   |
| 소규모 프로덕션   | 같은 서버라도 컨테이너 리소스 제한 필요  |
| 고성능/대규모 경우 | ML 노드는 물리 서버 또는 별 VM 분리 |

---

## 6. 요약

- **노드 역할 분리**와 **Docker 자원 제한 설정**이 핵심이다.
    
- ML 작업이 데이터 처리에 미치는 영향을 최소화하기 위해 `ml` 노드를 분리하고, threshold 설정을 사용한다.
    
- 운영 환경에서는 가능하면 ML 전용 머신으로 확장하는 것이 안정과 확장성 측면에서 최선이다.