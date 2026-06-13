---
title: 'Docker Compose로 개발 환경 구성: .env 기반 설정 관리와 서비스 설정 파일 분리 전략'
description: XGEN 백엔드 게이트웨이의 설정 파일을 local/docker/k8s 환경별로 분리하고, .env 파일로 민감 정보를 관리하는
  실전 구성 가이드
pubDatetime: 2026-01-20
tags:
- Docker Compose
- DevOps
- 환경 설정
- Rust
- K3s
- 도커
- 환경변수
---


## 배경

XGEN 2.0 개발 초기에는 모든 서비스 설정이 하나의 `services.yaml`에 담겨 있었다. K3s 환경 기준으로 작성된 파일이라 호스트가 쿠버네티스 서비스 이름(`xgen-core.xgen.svc.cluster.local`)으로 하드코딩되어 있었다.

로컬 개발 환경에서 개발자들이 이 파일을 직접 수정해서 `localhost:8002`로 바꾸고, K3s 배포 전에 다시 원래대로 돌려놓는 과정이 반복됐다. 설정을 되돌리는 걸 잊고 커밋하면 배포가 깨지는 사고가 생겼다.

환경별로 설정 파일을 분리하고, Docker Compose 환경에서는 `.env` 파일로 민감 정보를 관리하는 구조로 개편했다.

## 설정 파일 3분할 구조

```
xgen-backend-gateway/config/
├── config.yml           # 환경별 오버라이드 (APP_SITE 분기)
├── services.yaml        # K3s 기본값 (기존)
├── services.local.yaml  # 로컬 개발 (localhost:800x)
└── services.docker.yaml # Docker Compose (컨테이너명 기준)
```

게이트웨이는 시작 시 `APP_SITE` 환경변수를 읽어서 어떤 설정 파일을 로드할지 결정한다.

```
APP_SITE=local   → services.local.yaml
APP_SITE=docker  → services.docker.yaml
APP_SITE 없음    → services.yaml (K3s 기본)
```

### services.local.yaml

로컬에서 각 서비스를 직접 실행할 때 쓰는 설정이다. 모든 호스트가 `localhost`다.

```yaml
services:
  xgen-core:
    host: http://localhost:8002
    modules: [admin, auth, config, llm, data, session-station]
  retrieval-service:
    host: http://localhost:8003
    modules: [retrieval, documents, folder, embedding, data-processor, storage]
  xgen-model-service:
    host: http://localhost:8004
    modules: [inference, model, management]
  xgen-workflow-service:
    host: http://localhost:8001
    modules: [workflow, agent]
```

### services.docker.yaml

Docker Compose 환경에서는 컨테이너명으로 서비스를 찾는다. 같은 Docker 네트워크 안에 있으면 컨테이너명이 DNS 역할을 한다.

```yaml
services:
  xgen-core:
    host: http://xgen-core:8000
    modules: [admin, auth, config, llm, data, session-station]
  retrieval-service:
    host: http://xgen-documents:8000
    modules: [retrieval, documents, folder, embedding, data-processor, storage]
  xgen-model-service:
    host: http://xgen-model:8000
    modules: [inference, model, management]
DATABASE_URL: ${DATABASE_URL}
REDIS_URL: ${REDIS_URL}
```

`${DATABASE_URL}` 형식으로 환경변수를 참조한다. 이 값은 런타임에 실제 환경변수로 치환된다.

## Rust에서 ${VAR} 확장 처리

YAML 파서는 기본적으로 `${DATABASE_URL}` 같은 형식을 그냥 문자열로 읽는다. 환경변수 확장은 직접 구현해야 했다.

```rust
// src/config.rs
fn expand_yaml_value(raw: &str) -> String {
    let unquoted = raw.trim().trim_matches('"').trim_matches('\'');
    if unquoted.starts_with("${") && unquoted.ends_with("}") {
        let key = &unquoted[2..unquoted.len() - 1];
        std::env::var(key).unwrap_or_default()
    } else {
        unquoted.to_string()
    }
}
```

YAML 값을 읽을 때 이 함수를 거치면 `${DATABASE_URL}` → `postgresql://ailab:ailab123@postgresql:5432/plateerag`으로 치환된다. 환경변수가 없으면 빈 문자열을 반환한다.

### config.yml 환경별 오버라이드

```yaml
# xgen-backend-gateway/config/config.yml
default:
  DOCS_PAGE: false
  LOG_LEVEL: info

local:
  development:
    DOCS_PAGE: true
    DATABASE_URL: postgresql://ailab:ailab123@localhost:5432/plateerag_dev
    REDIS_URL: redis://localhost:6379

docker:
  development:
    DOCS_PAGE: true
    DATABASE_URL: ${DATABASE_URL}
    REDIS_URL: ${REDIS_URL}
    external:
      minio: http://minio:9000
      qdrant: http://qdrant:6333

k8s:
  production:
    DOCS_PAGE: false
    DATABASE_URL: ${DATABASE_URL}
```

`local` 환경에서는 DB URL을 직접 하드코딩(개발용 비밀번호라 무방)하고, `docker`와 `k8s` 환경에서는 환경변수로 주입받는다.

## Docker Compose 구성

### .env.example

```bash
# xgen-infra/compose/.env.example
GITLAB_TOKEN=your_gitlab_token_here
DOCKER_REGISTRY=docker.x2bee.com/xgen/main
IMAGE_TAG=latest-amd64
DATA_PATH=./data

# 포트
XGEN_BACKEND_GATEWAY_PORT=8080

# DB
POSTGRES_DB=plateerag
POSTGRES_USER=ailab
POSTGRES_PASSWORD=ailab123

# Redis
REDIS_PASSWORD=redis_secure_password123!

# GPU 설정
GPU_TYPE=nvidia  # nvidia | amd | cpu
```

`.env.example`은 git에 커밋한다. 실제 `.env`는 `.gitignore`에 추가해서 비밀번호가 레포에 들어가지 않도록 했다.

### docker-compose.yml 게이트웨이 서비스

```yaml
xgen-backend-gateway:
  image: ${DOCKER_REGISTRY}/xgen-backend-gateway:${IMAGE_TAG}
  container_name: xgen-backend-gateway
  ports:
    - "${XGEN_BACKEND_GATEWAY_PORT:-8080}:8080"
  environment:
    APP_SITE: "docker"
    APP_ENV: ${ENV:-development}
    DATABASE_URL: >-
      postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgresql:5432/${POSTGRES_DB}
    REDIS_URL: "redis://:${REDIS_PASSWORD}@redis:6379"
    SERVICES_CONFIG_FILE: /app/config/services.docker.yaml
  volumes:
    - ../xgen-backend-gateway/config/config.yml:/app/config/config.yml:ro
    - ../xgen-backend-gateway/config/services.docker.yaml:/app/config/services.docker.yaml:ro
  depends_on:
    postgresql:
      condition: service_healthy
    redis:
      condition: service_healthy
  networks:
    - xgen-network
```

몇 가지 설계 결정이 있다.

**볼륨 마운트로 설정 파일 주입**: 설정 파일을 이미지에 구워 넣지 않고 볼륨으로 마운트했다. 설정만 바꿀 때 이미지를 다시 빌드할 필요가 없다. `:ro`(read-only) 옵션으로 컨테이너가 설정 파일을 수정하지 못하도록 했다.

**depends_on condition**: `service_started`(기본값)가 아닌 `service_healthy`를 사용했다. PostgreSQL과 Redis가 실제로 접속 가능한 상태가 된 후에 게이트웨이가 시작된다. 그렇지 않으면 시작 직후 DB 연결 실패로 컨테이너가 재시작되는 루프가 생긴다.

**포트 기본값**: `${XGEN_BACKEND_GATEWAY_PORT:-8080}` 형식으로 `.env`에 값이 없을 때 기본값을 지정했다.

## 개발 환경 DB 분리

```bash
# 2026-01-20 커밋: 개발 환경 DB/Redis 설정 업데이트
# plateerag → plateerag_dev, dev_password123 등 개발 전용 값 분리
```

로컬 개발용 DB를 운영 DB와 완전히 분리했다. DB 이름부터 다르게 해서 실수로 운영 데이터를 건드리는 일이 없도록 했다.

```yaml
# services.local.yaml
DATABASE_URL: postgresql://ailab:dev_password123@localhost:5432/plateerag_dev
REDIS_URL: redis://localhost:6379  # 로컬 Redis는 인증 없음
```

```yaml
# services.docker.yaml (Docker Compose)
DATABASE_URL: ${DATABASE_URL}     # → postgresql://ailab:ailab123@postgresql:5432/plateerag
REDIS_URL: ${REDIS_URL}           # → redis://:redis_secure_password123!@redis:6379
```

로컬은 인증 없이 빠르게 개발하고, Docker Compose 환경은 운영과 동일한 인증 설정을 적용했다.

## 전체 실행 흐름

```bash
# 1. .env 파일 준비
cd xgen-infra/compose
cp .env.example .env
vim .env  # 비밀번호 설정

# 2. 전체 스택 실행
docker compose up -d

# 3. 게이트웨이 로그 확인
docker logs xgen-backend-gateway -f

# 로그 예시:
# [INFO] APP_SITE=docker, loading services.docker.yaml
# [INFO] Database connected: postgresql://...@postgresql:5432/plateerag
# [INFO] Redis connected: redis://:***@redis:6379
# [INFO] Server started on 0.0.0.0:8080
```

## 삽질: services.docker.yaml 경로 오류

초기 구성에서 볼륨 마운트 경로가 잘못됐었다.

```yaml
# 잘못된 경로
volumes:
  - ./config/services.docker.yaml:/app/config/services.docker.yaml:ro

# 올바른 경로 (docker-compose.yml이 compose/ 디렉토리에 있고,
# services.docker.yaml은 ../xgen-backend-gateway/config/에 있음)
volumes:
  - ../xgen-backend-gateway/config/services.docker.yaml:/app/config/services.docker.yaml:ro
```

`docker compose up` 실행 후 게이트웨이 컨테이너가 시작됐지만 서비스 라우팅이 전혀 안 됐다. 로그를 보니 설정 파일을 읽지 못해서 빈 서비스 목록으로 시작한 것이었다. 볼륨 마운트 경로의 상대 경로 기준이 `docker-compose.yml` 위치임을 확인하고 수정했다.

## 결과

- 환경별 설정 파일 분리로 "로컬에서 수정 후 되돌리기" 실수 제거
- `.env` 파일 기반으로 민감 정보 관리, git 히스토리에 비밀번호 노출 없음
- Rust의 `expand_yaml_value` 함수로 YAML 내 `${VAR}` 환경변수 확장 지원
- Docker Compose `depends_on: condition: service_healthy`로 서비스 기동 순서 보장

개발 환경 구성은 "한 번만 설정하면 끝"이 아니라 팀이 늘어나고 환경이 다양해질수록 계속 정비해야 한다. 환경별 설정 파일 분리와 `.env` 기반 관리는 이 과정에서 가장 효과적인 패턴이었다.
