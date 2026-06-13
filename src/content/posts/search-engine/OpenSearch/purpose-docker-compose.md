---
title: 목적에 맞는 OpenSearch Docker Compose 구성
description: OpenSearch를 Docker Compose로 배포하는 환경별 구성을 정리한다. 개발/PoC용 단일 노드 구성부터 프로덕션
  멀티 노드 클러스터, ML 노드 분리 구성까지 목적에 맞는 docker-compose.yml 예시를 다룬다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- Docker
- 검색엔진
- Docker Compose
- 클러스터
- 인프라
- Search Engine
---



# 목적에 맞는 OpenSearch Docker Compose 구성

## 1. 개발/PoC 용 단일 노드 (`docker-compose-poc.yml`)

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    container_name: os-poc
    environment:
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
      - DISABLE_SECURITY_PLUGIN=true
    ports:
      - "9200:9200"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: 최소 구성으로 빠르게 기능 시연, 테스트에 적합하다.


## 2. 개발/PoC + Performance Analyzer

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    container_name: os-poc-pa
    environment:
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
      - DISABLE_SECURITY_PLUGIN=true
    ports:
      - "9200:9200"
      - "9600:9600"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: `9600` 포트를 열어 성능 분석 모듈 사용 가능하다.

---

## 3. 테스트용 보안 비활성 단일 노드

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    container_name: os-nosec
    environment:
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
      - DISABLE_INSTALL_DEMO_CONFIG=true
      - DISABLE_SECURITY_PLUGIN=true
      - DISABLE_SECURITY_DASHBOARDS_PLUGIN=true
    ports:
      - "9200:9200"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: 보안 모듈을 완전히 비활성화하여 개발 환경 접근성을 높인다.

---

## 4. 벡터 검색 PoC 단일 노드

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    container_name: os-vector-poc
    environment:
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g
    ports:
      - "9200:9200"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: 플러그인을 Dockerfile에서 추가 빌드하고 벡터 검색 테스트 가능하다.


## 5. 중규모 운영: 클러스터 관리자 · 데이터 노드 분리

```yaml
version: "3.8"
services:
  master:
    image: opensearchproject/opensearch:latest
    container_name: os-master
    environment:
      - node.name=master
      - node.roles=cluster_manager
      - discovery.seed_hosts=master,data
      - cluster.initial_cluster_manager_nodes=master
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
    ulimits:
      memlock: { soft: -1, hard: -1 }

  data:
    image: opensearchproject/opensearch:latest
    container_name: os-data
    environment:
      - node.name=data
      - node.roles=data,ingest
      - discovery.seed_hosts=master,data
      - cluster.initial_cluster_manager_nodes=master
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx4g
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: 역할 분리를 통해 안정성과 처리 가능 성능 확보가 가능하다.


## 6. 중규모 운영: 다중 데이터 노드 + Dashboards

```yaml
version: "3.8"
services:
  master:
    <<: *master-def

  data1:
    image: opensearchproject/opensearch:latest
    container_name: os-data1
    environment:
      - node.name=data1
      - node.roles=data,ingest
      - discovery.seed_hosts=master,data1,data2
      - cluster.initial_cluster_manager_nodes=master
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx4g
    ulimits:
      memlock: { soft: -1, hard: -1 }
    volumes:
      - data1-vol:/usr/share/opensearch/data

  data2:
    <<: *data1
    container_name: os-data2
    environment:
      - node.name=data2
      - discovery.seed_hosts=master,data1,data2

  dashboards:
    image: opensearchproject/opensearch-dashboards:latest
    container_name: os-dash
    environment:
      - OPENSEARCH_HOSTS=["http://master:9200"]
    depends_on:
      - master
      - data1
      - data2
    ports:
      - "5601:5601"

volumes:
  data1-vol:
  data2-vol:
```

**설명**: 여러 데이터 노드로 색인·검색 요청 병렬 처리 가능하다.


## 7. 고가용성 3노드 클러스터 (`docker-compose-ha.yml`)

```yaml
version: "3.8"
services:
  node1, node2, node3:
    image: opensearchproject/opensearch:latest
    environment:
      - node.name=<각각>
      - node.roles=cluster_manager,data,ingest
      - discovery.seed_hosts=node1,node2,node3
      - cluster.initial_cluster_manager_nodes=node1,node2,node3
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g
    ulimits:
      memlock: { soft: -1, hard: -1 }
    networks:
      - os-net

networks:
  os-net:
    driver: bridge
```

**설명**: 복제(shard replica) 설정 시 한 노드 장애에도 자동 복구 가능하다.

## 8. ML/벡터 검색 분리 클러스터

```yaml
version: "3.8"
services:
  data:
    image: opensearchproject/opensearch:latest
    container_name: os-data
    environment:
      - node.roles=data,ingest
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx4g
    ulimits:
      memlock: { soft: -1, hard: -1 }

  ml:
    image: opensearchproject/opensearch:latest
    container_name: os-ml
    environment:
      - node.roles=ml
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g
      - plugins.ml_commons.only_run_on_ml_node=true
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: 벡터·ML 임베딩 처리만 전담하는 ML 노드를 분리해 자원 충돌 방지한다.


## 9. 대용량 벡터: on‑disk 모드

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    environment:
      - discovery.type=single-node
      - NODE_OPTIONS=-Dknn.engine=faissOnDisk
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx4g
    ports:
      - "9200:9200"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: `faissOnDisk` 모드로 메모리 절약하면서도 P90 응답 100–200ms 수준 유지 가능하다.


## 10. TLS 및 보안 구성 포함

```yaml
version: "3.8"
services:
  os:
    image: opensearchproject/opensearch:latest
    environment:
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g
      - plugins.security.ssl.http.enabled=true
      - plugins.security.ssl.http.keystore.type=jks
      - plugins.security.ssl.http.keystore.path=certs/http.jks
      - plugins.security.ssl.http.keystore.password=changeme
      - plugins.security.ssl.http.truststore.type=jks
      - plugins.security.ssl.http.truststore.path=certs/http.jks
      - plugins.security.ssl.http.truststore.password=changeme
    volumes:
      - ./certs:/usr/share/opensearch/config/certs:ro
    ports:
      - "9200:9200"
    ulimits:
      memlock: { soft: -1, hard: -1 }
```

**설명**: TLS 인증서를 마운트하여 보안 테스트 환경 구축이 가능하다.

## 구성 요약 표

|#|구성|목적|
|---|---|---|
|1|단일 노드 PoC|기능 검증, 빠른 배포|
|2|단일 노드 + Performance|성능 진단 시스템|
|3|단일 노드 + 보안 비활성|접근이 쉬운 테스트 환경|
|4|단일 노드 + 벡터 PoC|벡터 검색 기능 테스트|
|5|중규모(role 분리)|역할 구분으로 안정적 운영 구조 확보|
|6|다중 데이터 노드 + Dashboards|부하 분산 시스템 구축|
|7|HA 3노드 클러스터|장애 복구 및 가용성 강화|
|8|데이터 + ML 분리|벡터/ML 워크로드 자원 분리 최적화|
|9|벡터 on‑disk 모드|대용량 벡터 색인 시 메모리 절약 및 성능 유지|
|10|TLS 보안 구성 포함|보안 테스트 환경 구축|


## 결론 및 활용 팁

- 각각의 구성 파일은 **목적에 따라 바로 사용 가능**하며 복사하여 사용하면 된다.
    
- 운영 환경에서는 **TLS 구성, 자원 제한 설정, 백업 정책, 모니터링 추가**가 필요하다.
    
- 벡터 검색 성능, 샤드 전략 등 고도 설정은 추가 자료 요청할 경우 제공 가능하다.


## 현재 쓰고 있는 docker-compose.yml
```yaml
#
# sudo swapoff -a
# sudo vi /etc/sysctl.conf => vm.max_map_count=262144
# sudo sysctl -w vm.max_map_count=262144
# sudo sysctl -p
---
x-opensearch-environment: &opensearch-environment
  cluster.name: opensearch-cluster
  bootstrap.memory_lock: "true"
  OPENSEARCH_JAVA_OPTS: "-Xms4g -Xmx4g"
  OPENSEARCH_INITIAL_ADMIN_PASSWORD: "X2commerce!1"
  plugins.security.ssl.http.enabled: false

services:
  opensearch-node1:
    image: opensearchproject/opensearch:3
    container_name: opensearch-node1
    environment:
      <<: *opensearch-environment
      - node.name=opensearch-node1
      - discovery.seed_hosts=opensearch-node1,opensearch-node2
      - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
      - bootstrap.memory_lock=true
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536  # maximum number of open files for the OpenSearch user, set to at least 65536 on modern systems
        hard: 65536
    volumes:
      - opensearch-data1:/usr/share/opensearch/data
    ports:
      - 9200:9200
      - 9600:9600  # required for Performance Analyzer
    networks:
      - opensearch-net
  opensearch-node2:
    image: opensearchproject/opensearch:3
    container_name: opensearch-node2
    environment:
      <<: *opensearch-environment
      - node.name=opensearch-node2
      - discovery.seed_hosts=opensearch-node1,opensearch-node2
      - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
      - bootstrap.memory_lock=true
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    volumes:
      - opensearch-data2:/usr/share/opensearch/data
    networks:
      - opensearch-net
  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:3
    container_name: opensearch-dashboards
    ports:
      - 5601:5601
    expose:
      - '5601'
    environment:
      OPENSEARCH_HOSTS: '["https://opensearch-node1:9200","https://opensearch-node2:9200"]'
    networks:
      - opensearch-net

volumes:
  opensearch-data1:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-d1
  opensearch-data2:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-d2

networks:
  opensearch-net:
```

아래는 제공하신 OpenSearch Docker Compose 구성 파일을 **요소별로 분해하고 각 설정의 의미와 목적**을 상세히 설명한 정리이다. 시스템 커널 설정부터 각 서비스 구성, 노드 설정, 네트워크, 볼륨까지 전반적으로 분석하였다.

### 1. 커널 설정 (호스트 측)

```bash
sudo swapoff -a
```

- **의미**: 스왑 메모리를 비활성화한다.
    
- **목적**: OpenSearch는 안정적인 성능을 위해 스왑 사용을 권장하지 않는다.
    

```bash
sudo vi /etc/sysctl.conf
# 추가: vm.max_map_count=262144
```

- **의미**: 한 프로세스에서 사용할 수 있는 memory map 영역 수 제한을 증가시킨다.
    
- **목적**: Lucene 엔진이 메모리 맵 파일을 다수 사용하는데, 기본값(65530)으로는 부족하다.
    

```bash
sudo sysctl -w vm.max_map_count=262144
sudo sysctl -p
```

- **의미**: 설정을 즉시 적용하고 영구적으로 반영한다.
    
- **참고**: OpenSearch 및 Elasticsearch 등은 반드시 이 설정이 적용되어야 한다.
    

---

### 2. 공통 환경 변수 정의 (`x-opensearch-environment`)

```yaml
x-opensearch-environment: &opensearch-environment
  cluster.name: opensearch-cluster
  bootstrap.memory_lock: "true"
  OPENSEARCH_JAVA_OPTS: "-Xms4g -Xmx4g"
  OPENSEARCH_INITIAL_ADMIN_PASSWORD: "X2commerce!1"
  plugins.security.ssl.http.enabled: false
```

| 항목                                  | 설명                                            |
| ----------------------------------- | --------------------------------------------- |
| `cluster.name`                      | 클러스터 이름. 여러 노드가 동일한 클러스터로 인식되도록 설정            |
| `bootstrap.memory_lock`             | 메모리를 락(lock) 걸어 스왑 방지. 성능 안정성 확보              |
| `OPENSEARCH_JAVA_OPTS`              | JVM 힙 메모리 설정 (4GB로 고정). 시스템 메모리의 절반 이하로 설정 권장 |
| `OPENSEARCH_INITIAL_ADMIN_PASSWORD` | 초기 admin 계정 비밀번호 설정                           |
| `plugins.security.ssl.http.enabled` | HTTP 보안 비활성화 (기본 TLS OFF)                     |


### 3. OpenSearch 노드 설정

### (1) `opensearch-node1` / `opensearch-node2`

공통

```yaml
image: opensearchproject/opensearch:3
container_name: ...
environment:
  <<: *opensearch-environment
  - node.name=opensearch-nodeX
  - discovery.seed_hosts=opensearch-node1,opensearch-node2
  - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
  - bootstrap.memory_lock=true
ulimits:
  memlock:
    soft: -1
    hard: -1
  nofile:
    soft: 65536
    hard: 65536
```

|항목|설명|
|---|---|
|`node.name`|노드 식별 이름. 클러스터 내 고유해야 함|
|`discovery.seed_hosts`|초기 클러스터 탐색 대상 노드 목록. 클러스터 조인을 위해 반드시 설정|
|`cluster.initial_cluster_manager_nodes`|클러스터 초기 매니저 노드 목록. 클러스터 생성 시 필수|
|`ulimits.memlock`|메모리 락 제한을 무제한으로 설정하여 힙 메모리 고정 가능하게 함|
|`ulimits.nofile`|OpenSearch가 열 수 있는 파일 수. 65536 이상 권장|

#### 추가 항목 (node1)

```yaml
ports:
  - 9200:9200
  - 9600:9600
```

|포트|설명|
|---|---|
|`9200`|REST API 및 클라이언트 요청 포트|
|`9600`|Performance Analyzer(성능 분석 도구)용 포트|

#### 추가 항목 (volumes)

```yaml
volumes:
  - opensearch-dataX:/usr/share/opensearch/data
```

- 데이터 디렉토리를 로컬 경로에 바인딩하여 데이터 지속성을 확보


### 4. Dashboards 설정

```yaml
image: opensearchproject/opensearch-dashboards:3
container_name: opensearch-dashboards
ports:
  - 5601:5601
expose:
  - '5601'
environment:
  OPENSEARCH_HOSTS: '["https://opensearch-node1:9200","https://opensearch-node2:9200"]'
```

|항목|설명|
|---|---|
|`OPENSEARCH_HOSTS`|연결 대상 OpenSearch 노드의 주소. HTTPS 사용 시 TLS 인증서 필요|
|`5601`|Dashboards UI 포트 (Kibana와 유사)|
|`expose`|내부 Docker 네트워크에서 열리는 포트 (호스트에는 직접 노출되지 않음)|


### 5. 볼륨 설정

```yaml
volumes:
  opensearch-data1:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-d1
  opensearch-data2:
    ...
```

|항목|설명|
|---|---|
|`driver: local`|일반적인 Docker 호스트 볼륨 사용|
|`type: none` + `o: bind`|Docker에서 외부 디렉토리를 직접 마운트|
|`device`|실제 호스트 파일 시스템 경로. 디스크 분리/백업이 가능하게 구성됨|


### 6. 네트워크 설정

```yaml
networks:
  opensearch-net:
```

- 모든 컨테이너가 동일한 Docker bridge 네트워크에 속함
    
- 각 노드는 이 네트워크 상에서 `opensearch-node1`, `opensearch-node2` 등의 이름으로 서로를 인식함


### 종합 판단

| 항목          | 설정 수준       | 평가                         |
| ----------- | ----------- | -------------------------- |
| **클러스터 구성** | 2노드         | 다중 노드 기반 최소 클러스터 구성        |
| **자원 설정**   | JVM 힙 4GB   | 중간 규모 이상 처리량 가능            |
| **성능 모니터링** | 9600 포트 활성화 | Performance Analyzer 사용 가능 |
| **보안 설정**   | TLS 비활성     | 내부망 전용 또는 개발용 환경에 적합       |
| **디스크 마운트** | 로컬 경로 지정    | 운영 데이터 지속성 확보              |
| **확장성**     | 높음          | 3번째 노드 추가 시 고가용성 구성 완성 가능  |


필요 시 다음 항목도 추가 구성 가능하다.

- `node.roles` 분리 (cluster_manager, data, ingest, ml)
    
- `plugins.security.*`로 TLS 인증 및 로그인 설정
    
- `replica`, `shard` 수 설정
    
- 벡터 검색/ML 기능 확장 (예: `ml` 노드 추가)


## 여기에 ML 노드를 추가하면?

현재 구성에 **ML 전용 노드 (`opensearch-ml-node`)를 하나 추가**하려면, 아래와 같이 Docker Compose에 노드를 하나 더 정의하고 `node.roles=ml`을 설정하면 된다. 

이 노드는 ML 추론 전용이며, text embedding, 벡터 생성 등에 활용된다.

```yaml
services:
  opensearch-node1:
    image: opensearchproject/opensearch:3
    container_name: opensearch-node1
    environment:
      <<: *opensearch-environment
      - node.name=opensearch-node1
      - discovery.seed_hosts=opensearch-node1,opensearch-node2,opensearch-ml-node
      - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
    ...

  opensearch-node2:
    image: opensearchproject/opensearch:3
    container_name: opensearch-node2
    environment:
      <<: *opensearch-environment
      - node.name=opensearch-node2
      - discovery.seed_hosts=opensearch-node1,opensearch-node2,opensearch-ml-node
      - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
    ...

  opensearch-ml-node:
    image: opensearchproject/opensearch:3
    container_name: opensearch-ml-node
    environment:
      <<: *opensearch-environment
      - node.name=opensearch-ml-node
      - node.roles=ml
      - discovery.seed_hosts=opensearch-node1,opensearch-node2,opensearch-ml-node
      - cluster.initial_cluster_manager_nodes=opensearch-node1,opensearch-node2
      - plugins.ml_commons.only_run_on_ml_node=true
      - plugins.ml_commons.task_dispatch_policy=round_robin
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    volumes:
      - opensearch-data-ml:/usr/share/opensearch/data
    networks:
      - opensearch-net

volumes:
  opensearch-data1:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-d1
  opensearch-data2:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-d2
  opensearch-data-ml:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /home/tech/data/opensearch-dir/data-ml

```

### 주요 변경사항 요약

| 항목                                                    | 설명                                             |
| ----------------------------------------------------- | ---------------------------------------------- |
| `node.roles=ml`                                       | ML 전용 노드로 설정하여 색인, 검색 등의 작업은 하지 않고 ML 태스크만 처리함 |
| `plugins.ml_commons.only_run_on_ml_node=true`         | ML 태스크가 이 노드에서만 실행되도록 제한                       |
| `discovery.seed_hosts`                                | 모든 노드에서 ml 노드를 포함하여 클러스터에 조인하도록 설정             |
| `cluster.initial_cluster_manager_nodes`               | ML 노드는 manager가 아니므로 여기에 포함되지 않음               |
| `plugins.ml_commons.task_dispatch_policy=round_robin` | ML 태스크 분산 방식 설정 (옵션)                           |


OpenSearch에서 **ML 전용 노드만 사용되도록 설정하려면**, 다음 2가지 설정이 핵심이다.

### 1. `node.roles: ml`

```yaml
- node.roles=ml
```

- 이 노드는 **색인(indexing), 검색(query), cluster manager 역할을 하지 않고**, **ML 작업만 수행**하도록 지정된다.
    
- OpenSearch 2.x 이상부터는 노드 역할(role)을 명시하지 않으면 기본적으로 `["data", "ingest", "cluster_manager", "remote_cluster_client", "ml"]` 역할을 모두 수행한다.
    
- 따라서 `node.roles=ml`을 명시적으로 설정해야 **진짜 전용 ML 노드**가 된다.


### 2. `plugins.ml_commons.only_run_on_ml_node: true`

```yaml
- plugins.ml_commons.only_run_on_ml_node=true
```

- 이 설정이 `true`이면 ML Commons는 **`node.roles`에 `ml`만 포함된 노드에서만 ML 태스크를 실행**한다.
    
- 일반 data 노드가 ML 태스크를 처리하지 않게 된다.
    
- 따라서 이 설정을 반드시 추가해야 ML 전용 노드가 아닌 다른 노드에서 embedding 생성, 모델 추론 등의 ML 작업이 발생하지 않는다.


### 예시 요약

```yaml
  opensearch-ml-node:
    environment:
      - node.roles=ml
      - plugins.ml_commons.only_run_on_ml_node=true
```

이렇게 설정하면 ML 태스크(`text_embedding`, `model_predict`, `model_train`) 등은 오직 `opensearch-ml-node`에서만 처리된다.


### 추가 옵션 (선택)

| 설정 키                                         | 설명                       | 예시                            |
| -------------------------------------------- | ------------------------ | ----------------------------- |
| `plugins.ml_commons.task_dispatch_policy`    | 여러 ML 노드가 있을 때 태스크 분산 방식 | `round_robin` 또는 `least_load` |
| `plugins.ml_commons.native_memory_threshold` | ML 태스크 실행 전, 메모리 점유율 기준  | `90` (90% 이상이면 거부)            |
| `plugins.ml_commons.max_ml_task_per_node`    | 동시에 수행할 수 있는 ML 태스크 개수   | `2` 등등                        |


### 결론

**"해당 ML 노드만 ML 태스크를 수행"** 하도록 하려면 반드시 다음 두 가지를 같이 설정해야 한다.

1. `node.roles=ml` → ML 이외의 역할 제거
    
2. `plugins.ml_commons.only_run_on_ml_node=true` → ML 노드에서만 태스크 실행 제한

이 구성을 통해 운영 클러스터의 색인·검색 성능에 영향을 주지 않고 ML 기능을 안정적으로 분리할 수 있다.