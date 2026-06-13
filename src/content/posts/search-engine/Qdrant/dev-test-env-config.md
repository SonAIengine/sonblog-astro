---
title: Qdrant 개발 및 테스트 환경 설정 — Docker, 빌드, 포트 구성
description: Qdrant를 개발/테스트 환경에서 실행하고 관리하는 방법을 정리한다. Docker 실행, 소스 빌드, REST/gRPC 포트
  설정, 분산 클러스터 네트워크 구성을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Docker
- 개발환경
- gRPC
- Search Engine
---


Qdrant는 고성능 벡터 검색을 위한 오픈소스 검색 엔진으로, Docker 기반의 간편한 실행부터 직접 빌드까지 다양한 개발 환경에서 테스트 및 운용이 가능하다. 

또한 단일 인스턴스는 물론, 분산 클러스터로 확장하기 위한 네트워크 구성도 명확히 정의되어 있다.

이 글에서는 Qdrant를 개발·테스트 용도로 실행하고 관리하는 방법과, 필수 포트를 포함한 네트워크 설정에 대해 정리한다.


## 1. Docker로 실행하기

### 1.1 기본 실행

가장 간단한 실행 방식은 Docker를 이용한 컨테이너 실행이다.

```bash
docker pull qdrant/qdrant
docker run -p 6333:6333 \
           -v $(pwd)/qdrant_data:/qdrant/storage \
           qdrant/qdrant
```

- Qdrant 데이터는 `./qdrant_data` 디렉토리에 저장된다.
    
- 포트 `6333`은 REST API, 상태 확인, 메트릭 수집에 사용된다.

### 1.2 사용자 설정 파일 적용

```bash
docker run -p 6333:6333 \
           -v $(pwd)/qdrant_data:/qdrant/storage \
           -v $(pwd)/custom_config.yaml:/qdrant/config/production.yaml \
           qdrant/qdrant
```

또는 명시적으로 설정 경로를 지정하여 실행할 수 있다.

```bash
docker run -p 6333:6333 \
           -v $(pwd)/qdrant_data:/qdrant/storage \
           -v $(pwd)/custom_config.yaml:/qdrant/config/custom_config.yaml \
           qdrant/qdrant \
           ./qdrant --config-path config/custom_config.yaml
```


## 2. Docker Compose로 실행하기

Docker Compose를 통해 좀 더 구조화된 방식으로 Qdrant를 실행할 수 있다.

### 2.1 Compose 예시 (단일 노드)

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    restart: always
    ports:
      - 6333:6333  # HTTP API
      - 6334:6334  # gRPC API
      - 6335:6335  # 클러스터 통신용
    expose:
      - 6333
      - 6334
      - 6335
    configs:
      - source: qdrant_config
        target: /qdrant/config/production.yaml
    volumes:
      - ./qdrant_data:/qdrant/storage

configs:
  qdrant_config:
    content: |
      log_level: INFO
```

> `configs` 기능은 Docker Compose v2.23.1 이상, Docker Engine v25.0.0 이상에서 사용 가능하다.


## 3. 네트워크 구성 (Networking)

Qdrant는 클라이언트 및 분산 환경에서의 연결을 위해 총 **3개의 포트**가 필요하다.

|포트 번호|용도|
|---|---|
|6333|RESTful HTTP API, 상태 확인, Prometheus 메트릭 수집|
|6334|gRPC API|
|6335|클러스터 노드 간 통신 (분산 환경)|

### 분산 클러스터 환경에서는 다음을 만족해야 한다.

- 모든 Qdrant 노드는 포트 6333, 6334, 6335를 통해 서로 통신할 수 있어야 한다.
    
- 외부 클라이언트는 포트 6333 (HTTP) 또는 6334 (gRPC)를 통해 접근할 수 있어야 한다.


## 4. 소스 빌드 (Rust 기반)

Qdrant는 Rust로 작성되어 있으며, 직접 바이너리로 빌드할 수 있다.

### 4.1 사전 준비

- Rust toolchain 설치 (`rustup`)
    
- OS별 필수 라이브러리 설치 (Dockerfile 참고)

### 4.2 빌드 명령

```bash
cargo build --release --bin qdrant
```

- 빌드 결과 바이너리는 `./target/release/qdrant`에 위치한다.


## 5. 클라이언트 라이브러리

Qdrant는 다양한 언어에 대한 공식 클라이언트 라이브러리를 제공한다.

|언어|패키지 / 링크|
|---|---|
|Python|`qdrant-client` ([PyPI](https://pypi.org/project/qdrant-client/))|
|TypeScript|`@qdrant/js-client-rest`|
|Go|`github.com/qdrant/go-client`|
|Java|Gradle/Maven용 Qdrant 클라이언트|
|Rust|`qdrant-client` crate|
|C# (.NET)|`Qdrant.Client` (NuGet)|


## 결론

Qdrant는 Docker, Docker Compose, Rust 빌드 등 다양한 방식으로 개발 환경을 쉽게 구성할 수 있으며, 멀티 포트 구성과 클러스터 통신을 고려한 네트워크 설정을 통해 프로덕션 확장에도 유연하게 대응할 수 있다.

- 단일 개발 환경: Docker 단일 실행 또는 Compose
    
- 클러스터 환경: 포트 6333/6334/6335 오픈 및 노드 간 연결 필요
    
- 고성능 검색: gRPC 포트를 통한 빠른 클라이언트 통신 가능
    
- 유연한 설정: 커스텀 구성 파일 및 다중 언어 클라이언트 연동