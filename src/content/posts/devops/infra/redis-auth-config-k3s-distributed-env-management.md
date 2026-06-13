---
title: Redis 인증 설정과 K3s 분산 환경 시크릿 관리
description: REDIS_PASSWORD를 6개 서비스에 일관되게 적용하고, Docker Compose와 K3s 환경에서 시크릿을 안전하게
  관리하는 방법
pubDatetime: 2026-02-04
tags:
- Redis
- Kubernetes
- K3s
- DevOps
- 시크릿 관리
- 보안
- 쿠버네티스
---


## 배경

XGEN 2.0을 처음 구축할 때 Redis는 인증 없이 운영했다. 개발 초기에는 빠른 셋업이 우선이었고, 내부 네트워크라 인증이 없어도 당장 문제가 없었다.

그런데 XGEN을 외부 고객사(롯데홈쇼핑)에 납품하면서 상황이 달라졌다. 폐쇄망이라도 내부 보안 요건이 있었고, "Redis 인증 없음"은 보안 감사에서 지적될 수 있는 항목이다. 인증을 추가하면서 6개 서비스(xgen-core, xgen-workflow, xgen-documents, xgen-model, xgen-mcp-station, xgen-backend-gateway)에 환경변수를 일관되게 적용해야 했다.

## Redis requirepass 설정

### Docker Compose (인프라 컴포넌트)

```yaml
# compose/k3s-infra/docker-compose.yml
# # 커밋: fix: Redis 인증을 위한 REDIS_PASSWORD 환경변수 추가
# # 날짜: 2026-02-04
redis:
  image: redis:8.0-alpine
  container_name: xgen-redis
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --appendonly yes
    --maxmemory 2gb
    --maxmemory-policy allkeys-lru
    --loglevel notice
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
  restart: unless-stopped
```

`healthcheck`에서도 `-a ${REDIS_PASSWORD}` 옵션이 필요하다. 인증이 활성화된 Redis에 `redis-cli ping`만 보내면 `NOAUTH Authentication required` 에러가 나서 healthcheck가 계속 실패한다.

`--no-auth-warning`은 명령줄에 비밀번호를 직접 넣는 경우 나오는 보안 경고 메시지를 억제한다. healthcheck 로그가 지저분해지지 않도록 필요하다.

### .env 파일 관리

```bash
# compose/k3s-infra/.env.example
REDIS_PASSWORD=change_me_in_production

POSTGRES_PASSWORD=change_me_in_production
MINIO_ROOT_PASSWORD=change_me_in_production
```

`.env.example`을 git에 커밋하고, 실제 `.env`는 `.gitignore`에 추가했다. 새 서버 세팅 시 `.env.example`을 복사해서 비밀번호만 변경하면 된다.

```bash
cp compose/k3s-infra/.env.example compose/k3s-infra/.env
vim compose/k3s-infra/.env  # 비밀번호 변경
```

## K3s Helm Chart 환경변수 적용

K3s 환경에서는 각 서비스의 `values.yaml`에 `REDIS_PASSWORD`를 추가했다.

```yaml
# k3s/helm-chart/values/xgen-core.yaml
config:
  POSTGRES_HOST: "postgresql.xgen-system.svc.cluster.local"
  POSTGRES_PORT: "5432"
  POSTGRES_DB: "xgendb"
  REDIS_HOST: "redis.xgen-system.svc.cluster.local"
  REDIS_PORT: "6379"
  REDIS_PASSWORD: "redis_secure_password123!"   # 추가
  REDIS_DB: "0"
```

같은 패턴으로 xgen-workflow, xgen-documents, xgen-model, xgen-mcp-station에도 적용했다.

### K8s Secret으로 분리 (보안 강화)

values.yaml에 비밀번호를 평문으로 넣는 것은 git 히스토리에 남아서 좋지 않다. 더 나은 방법은 K8s Secret으로 분리하는 것이다.

```yaml
# k3s/helm-chart/templates/deployment.yaml
containers:
- name: {{ .Values.service.name }}
  env:
  - name: REDIS_PASSWORD
    valueFrom:
      secretKeyRef:
        name: xgen-secrets
        key: redis-password
```

```yaml
# k3s/helm-chart/secrets/xgen-secrets.yaml (git에 커밋하지 않음)
apiVersion: v1
kind: Secret
metadata:
  name: xgen-secrets
  namespace: xgen
type: Opaque
stringData:
  redis-password: "redis_secure_password123!"
  postgres-password: "pg_secure_password!"
```

Secret YAML 파일은 `.gitignore`에 추가하고, 최초 클러스터 구성 시 수동으로 `kubectl apply`한다.

```bash
# 클러스터 초기 구성 시
kubectl create namespace xgen
kubectl apply -f k3s/helm-chart/secrets/xgen-secrets.yaml
# 이후 ArgoCD sync
```

## 서비스별 Redis 연결 코드

Python 서비스(FastAPI)에서는 `redis.asyncio`로 연결한다.

```python
# xgen-core/redis_client.py
import redis.asyncio as redis
from app.config import settings

class RedisClient:
    _instance: redis.Redis | None = None

    @classmethod
    async def get_instance(cls) -> redis.Redis:
        if cls._instance is None:
            cls._instance = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                password=settings.REDIS_PASSWORD or None,  # 빈 문자열이면 None
                db=settings.REDIS_DB,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
            )
        return cls._instance

    @classmethod
    async def close(cls):
        if cls._instance:
            await cls._instance.aclose()
            cls._instance = None
```

`password=settings.REDIS_PASSWORD or None`으로 처리하면 개발 환경에서 `REDIS_PASSWORD`를 빈 문자열로 설정했을 때 인증 없이 연결된다. 프로덕션에서는 값이 있으니 인증이 적용된다.

```python
# app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""   # 기본값 빈 문자열
    REDIS_DB: int = 0

    class Config:
        env_file = ".env"
```

## Rust 서비스에서 Redis 연결

xgen-backend-gateway는 Rust로 작성됐다.

```toml
# Cargo.toml
[dependencies]
redis = { version = "0.24", features = ["tokio-comp", "connection-manager"] }
```

```rust
// src/redis.rs
use redis::{aio::ConnectionManager, Client};

pub async fn create_redis_connection(
    host: &str,
    port: u16,
    password: Option<&str>,
    db: u32,
) -> Result<ConnectionManager, redis::RedisError> {
    let url = match password {
        Some(pw) if !pw.is_empty() => {
            format!("redis://:{}@{}:{}/{}", pw, host, port, db)
        }
        _ => format!("redis://{}:{}/{}", host, port, db),
    };

    let client = Client::open(url)?;
    ConnectionManager::new(client).await
}
```

Redis URL 형식: `redis://:비밀번호@호스트:포트/DB번호`. 비밀번호 앞에 콜론(`:`)이 있다는 점을 주의해야 한다.

## 인증 추가 후 발생한 문제들

### xgen-mcp-station 연결 실패

```bash
# 에러 로그
WRONGPASS invalid username-password pair or user is disabled.
```

처음 `REDIS_PASSWORD` 환경변수를 추가할 때 xgen-mcp-station을 빠뜨렸다. 나머지 서비스에 인증이 적용됐는데 xgen-mcp-station만 인증 없이 연결을 시도해서 에러가 났다.

```bash
# # 커밋: feat: xgen-mcp-station Redis 암호 환경변수 추가
# # 날짜: 2026-02-03
```

6개 서비스 모두 체크리스트를 만들어두지 않으면 하나씩 빠뜨리게 된다.

```
Redis 인증 적용 체크리스트:
- [x] xgen-core
- [x] xgen-workflow
- [x] xgen-documents
- [x] xgen-model
- [x] xgen-mcp-station  ← 처음에 빠뜨렸던 것
- [x] xgen-backend-gateway
- [x] compose/k3s-infra redis 서비스
- [x] healthcheck 명령에 -a 옵션
```

### Redis healthcheck 타이밍

Redis 컨테이너가 뜨기 전에 의존하는 서비스들이 연결을 시도해서 실패하는 문제가 있었다. Docker Compose의 `depends_on`에 `condition: service_healthy`를 추가해서 Redis가 healthy 상태가 된 후 다른 서비스가 뜨도록 했다.

```yaml
# compose/full-stack/docker-compose.yml
xgen-core:
  depends_on:
    redis:
      condition: service_healthy
    postgresql:
      condition: service_healthy
```

K3s 환경에서는 서비스가 연결 실패 시 재시도하는 로직이 있어서 Pod가 몇 번 재시작된 후 안정화됐다.

## Helm Values에서 시크릿 분리 전략

values.yaml에 비밀번호를 직접 쓰는 방식의 문제는 분명하다. XGEN 2.0에서 최종적으로 정리한 전략은 세 레이어로 분리하는 것이다.

```
레이어 1: values.yaml (git 관리)
  - 비민감 설정: 호스트, 포트, DB 번호, 기능 플래그

레이어 2: K8s Secret (git 미관리, kubectl apply)
  - 비밀번호, API 키, 토큰

레이어 3: ConfigMap (git 관리 가능)
  - 환경별 설정, 기능 on/off
```

```yaml
# values.yaml (git에 커밋)
config:
  REDIS_HOST: "redis.xgen-system.svc.cluster.local"
  REDIS_PORT: "6379"
  REDIS_DB: "0"
  # REDIS_PASSWORD는 Secret에서 주입

secrets:
  existingSecret: "xgen-secrets"
  redisPasswordKey: "redis-password"
```

```yaml
# templates/deployment.yaml
env:
{{- range $key, $value := .Values.config }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.redisPasswordKey }}
```

이렇게 하면 values.yaml만 봐서는 비밀번호를 알 수 없고, git 히스토리에도 남지 않는다.

## 결과

- Redis 인증 없음 → `requirepass` 적용으로 보안 강화
- 6개 서비스 일관된 `REDIS_PASSWORD` 환경변수 적용
- healthcheck에 `-a` 옵션 추가로 오탐 방지
- K8s Secret 분리 전략으로 비밀번호 git 노출 방지

인증 없는 Redis는 내부 네트워크에서도 같은 클러스터의 다른 네임스페이스나 악의적인 Pod가 접근할 수 있다. 마이크로서비스 환경에서 Redis 인증은 선택이 아니라 기본이다.
