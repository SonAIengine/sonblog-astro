---
title: XGEN K3s 인프라 완전 해부 (1) — 전체 구조와 컨테이너 빌드 전략
description: XGEN 2.0 AI 에이전트 플랫폼의 K3s 기반 인프라를 처음부터 끝까지 해부한다. 1편에서는 전체 아키텍처 구조, Python/Rust/Node.js
  4종 Dockerfile 멀티스테이지 빌드 전략, Docker Compose 인프라 스택, K8s-Docker 경계 연결 패턴을 다룬다.
pubDatetime: 2026-02-21
tags:
- K3s
- Kubernetes
- Docker
- Dockerfile
- Docker Compose
- Multi-Stage Build
- BuildKit
- XGEN
- DevOps
- 인프라
---


# XGEN K3s 인프라 완전 해부 (1) — 전체 구조와 컨테이너 빌드 전략

XGEN 2.0은 AI 에이전트 플랫폼이다. 워크플로우 기반으로 LLM, 문서 검색, MCP 도구를 조합하여 업무를 자동화하는 시스템으로, 6개의 마이크로서비스가 K3s 클러스터 위에서 동작한다. 이 시리즈는 그 인프라 코드(`xgen-infra` 레포지토리)를 처음부터 끝까지 해부하는 글이다.

1편에서는 전체 구조를 조망하고, 모든 서비스의 시작점인 Dockerfile과 Docker Compose를 분석한다.

## 시리즈 목차

- **1편: 전체 구조와 컨테이너 빌드 전략** (현재 글)
- [2편: Kubernetes 핵심 오브젝트와 스케일링 전략](xgen-k3s-anatomy-2-kubernetes-core-objects.md)
- [3편: Helm 차트 설계 — 하나의 Chart로 6개 서비스 배포하기](xgen-k3s-anatomy-3-helm-chart-design.md)
- [4편: CI/CD 파이프라인 — Jenkins 빌드에서 ArgoCD 배포까지](xgen-k3s-anatomy-4-cicd-jenkins-argocd.md)
- [5편: Istio 서비스 메시와 Observability 스택](xgen-k3s-anatomy-5-istio-observability.md)

---

## 전체 아키텍처

XGEN 인프라는 크게 세 계층으로 나뉜다.

```mermaid
flowchart LR
    subgraph Source["소스코드"]
        GL[GitLab<br/>6개 서비스 레포]
        GI[GitLab<br/>xgen-infra 레포]
    end

    subgraph CI["빌드"]
        JK[Jenkins<br/>:30090]
        NX[Nexus Registry<br/>docker.x2bee.com]
    end

    subgraph CD["배포"]
        AC[ArgoCD<br/>:30092]
    end

    subgraph K3s["K3s 클러스터"]
        direction TB
        FE[xgen-frontend<br/>Next.js :3000]
        GW[xgen-backend-gateway<br/>Rust :8000]
        CO[xgen-core<br/>Python :8000]
        WF[xgen-workflow<br/>Python :8000]
        DC[xgen-documents<br/>Python :8000]
        MC[xgen-mcp-station<br/>Node.js :8000]
    end

    subgraph Docker["Docker Compose"]
        PG[PostgreSQL]
        RD[Redis]
        QD[Qdrant]
        MN[MinIO]
    end

    GL --> JK
    GI --> JK
    JK --> NX
    GI --> AC
    NX --> K3s
    AC --> K3s
    K3s --> Docker
```

**빌드 계층**: GitLab 소스를 Jenkins가 Docker 이미지로 빌드하여 Nexus Registry에 push한다.

**배포 계층**: ArgoCD가 xgen-infra 레포의 Helm Chart 변경을 감시하고, 수동 Sync로 K3s 클러스터에 반영한다.

**실행 계층**: 앱 서비스 6개는 K3s(Kubernetes)가 관리하고, 인프라 서비스(DB, 캐시, 벡터DB, 오브젝트 스토리지)는 Docker Compose로 호스트에서 직접 실행한다.

### xgen-infra 디렉토리 구조

인프라 코드는 단일 레포지토리에 모여 있다.

```
xgen-infra/
├── dockerfiles/                # 서비스별 Dockerfile
│   ├── xgen-python/            #   Python 서비스 공용 (core, workflow, documents)
│   ├── xgen-frontend/          #   Next.js
│   ├── xgen-backend-gateway/   #   Rust/Axum
│   └── xgen-mcp-station/       #   Python + Node.js
├── compose/
│   ├── k3s-infra/              # 인프라 서비스 (PostgreSQL, Redis, Qdrant, MinIO)
│   └── full-stack/             # K8s 없이 단독 배포용 (전체 스택)
├── k3s/
│   ├── helm-chart/             # 범용 Helm 차트 (6개 서비스 공용)
│   ├── argocd/                 # ArgoCD App of Apps 설정
│   ├── jenkins/                # Jenkins 파이프라인 + 설정
│   ├── observability/          # 모니터링 스택 (Prometheus, Grafana, Loki, Tempo)
│   ├── cluster/                # K8s Secret, External Services
│   └── scripts/                # 설치 자동화 스크립트
└── docs/                       # 배포 가이드, 트러블슈팅
```

핵심 설계 원칙은 **설정과 로직의 분리**다. Jenkins 파이프라인(`build.groovy`)은 빌드 로직만 담고, 무엇을 빌드할지는 YAML 설정 파일이 결정한다. Helm Chart는 템플릿 하나로 6개 서비스를 모두 배포하며, 서비스별 차이는 values 파일로만 표현한다.

### 6개 마이크로서비스

| 서비스 | 언어/프레임워크 | 역할 | 포트 |
|--------|---------------|------|------|
| xgen-frontend | Next.js | 웹 UI, API 프록시, SSE 스트리밍 중계 | 3000 |
| xgen-backend-gateway | Rust/Axum | API Gateway, 인증, 라우팅 | 8000 |
| xgen-core | Python/FastAPI | 세션 관리, 에이전트 실행, LLM 호출 | 8000 |
| xgen-workflow | Python/FastAPI | 워크플로우 엔진, 노드 실행 | 8000 |
| xgen-documents | Python/FastAPI | 문서 업로드, 임베딩, 벡터 검색 | 8000 |
| xgen-mcp-station | Python + Node.js | MCP 서버 관리, 도구 실행 | 8000 |

4개 언어/런타임(Python, Rust, Node.js, Python+Node.js)을 사용하므로, Dockerfile도 4종류가 필요하다.

---

## Dockerfile 멀티스테이지 빌드 전략

모든 서비스의 Dockerfile은 멀티스테이지 빌드를 사용한다. 빌드에 필요한 도구(컴파일러, 패키지 매니저)와 실행에 필요한 최소 환경을 분리하여, 최종 이미지 크기를 줄이고 보안 공격 면을 축소하는 전략이다.

### Python 서비스 — pyproject.toml 의존성 분리

Python 서비스(core, workflow, documents)는 공용 Dockerfile을 사용한다. 핵심은 `pyproject.toml`에서 의존성 목록만 추출하여 먼저 설치하는 패턴이다.

```dockerfile
# ── Builder Stage ─────────────────────
FROM python:3.14-slim AS builder
WORKDIR /app

# 시스템 패키지 설치 (apt 캐시 마운트)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev

# 의존성 파일만 먼저 복사 (캐시 최적화 핵심)
COPY pyproject.toml .

# pyproject.toml에서 dependencies 추출 → 설치
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install tomli && \
    python -c "import tomli; \
      deps=tomli.loads(open('pyproject.toml').read())['project']['dependencies']; \
      print('\n'.join(deps))" > /tmp/requirements.txt && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# 소스코드 복사 (이 시점에서야 전체 코드가 들어옴)
COPY . .

# ── Runner Stage ──────────────────────
FROM python:3.14-slim
WORKDIR /app

RUN useradd -m -u 1000 app
COPY --from=builder /usr/local/lib/python3.14/site-packages /usr/local/lib/python3.14/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app

USER app
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]
```

`pip install .`은 전체 소스 디렉토리가 필요하다. 따라서 소스가 바뀔 때마다 의존성 설치 레이어가 무효화되는 문제가 있다. 이를 해결하기 위해 `pyproject.toml`만 먼저 복사하고, Python 스크립트로 `[project].dependencies` 목록을 추출한 뒤 `requirements.txt`를 생성하여 설치한다.

레이어 캐시 효과를 정리하면 이렇다.

```
소스코드만 수정한 경우:
  레이어 1 (FROM)           → 캐시 히트
  레이어 2 (COPY pyproject) → 캐시 히트 (pyproject.toml 미변경)
  레이어 3 (RUN pip)        → 캐시 히트 (의존성 재설치 스킵, 2~3분 절약)
  레이어 4 (COPY . .)       → 재빌드 (소스 변경)
  → 빌드 시간: 수 초

pyproject.toml 수정한 경우:
  레이어 1                  → 캐시 히트
  레이어 2                  → 재빌드 (파일 변경)
  레이어 3                  → 재빌드 (의존성 전체 재설치)
  레이어 4                  → 재빌드
  → 빌드 시간: 2~3분
```

`--mount=type=cache`는 BuildKit의 캐시 마운트 기능이다. 빌드 간에 pip 다운로드 캐시를 공유하므로, 의존성 레이어가 무효화되더라도 패키지 자체는 다시 다운로드하지 않는다.

### Rust Gateway — 빈 main.rs 트릭

Rust 빌드는 `cargo build`가 Cargo.toml/Cargo.lock만으로 의존성을 컴파일할 수 있다는 점을 활용한다. 빈 `main.rs`를 만들어 의존성을 먼저 빌드하고, 실제 소스코드는 나중에 복사하여 증분 빌드를 유도한다.

```dockerfile
# ── Builder Stage ─────────────────────
FROM rust:1.88-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./

# 빈 main.rs로 의존성만 먼저 컴파일
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && rm -rf src

# 실제 소스 복사 → 증분 빌드
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    touch src/main.rs && cargo build --release

# ── Runner Stage (최소 이미지) ────────
FROM debian:bookworm-slim
COPY --from=builder /app/target/release/xgen-backend-gateway /usr/local/bin/
EXPOSE 8080
CMD ["xgen-backend-gateway"]
```

Rust 의존성 컴파일은 수 분에서 십 수 분까지 걸린다. 빈 `main.rs` 트릭으로 의존성 레이어를 분리하면, 소스코드 수정 시 증분 빌드만 수행하여 빌드 시간을 극적으로 단축할 수 있다.

Runner 스테이지에서 `debian:bookworm-slim`(약 80MB)으로 전환하는 것도 중요하다. Rust 빌드 이미지(`rust:1.88-bookworm`)는 2GB 이상이지만, 최종 이미지에는 컴파일된 바이너리 하나만 복사하므로 100MB 이하로 줄어든다.

Rust Gateway는 이미 Dockerfile 자체에서 캐시 최적화가 되어 있어서 `.local` 변형이 필요 없다. Python과 달리 `cargo build`가 전체 소스 디렉토리 없이도 의존성을 빌드할 수 있기 때문이다.

### Next.js Frontend — 3단계 빌드

Frontend는 deps, builder, runner 세 스테이지로 나뉜다.

```dockerfile
# ── Stage 1: Dependencies ─────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# ── Stage 2: Builder ──────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ── Stage 3: Runner ───────────────────
FROM node:22-slim
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
```

deps 스테이지에서 `npm ci`로 정확한 버전의 패키지를 설치하고, builder 스테이지에서 `node_modules`를 복사받아 빌드한다. `.next/cache` 디렉토리를 캐시 마운트하여 Next.js 빌드 캐시도 빌드 간에 공유한다.

runner 스테이지에는 빌드 결과물(`.next`)과 정적 파일(`public`)만 복사한다. 소스코드, 개발 의존성, 빌드 도구 등은 포함되지 않는다.

### 4종 Dockerfile 비교

| | Python 서비스 | Rust Gateway | Next.js Frontend | MCP Station |
|---|---|---|---|---|
| **베이스 이미지** | python:3.14-slim | rust:1.88-bookworm → debian:slim | node:22-slim | python:3.14-slim + Node.js |
| **스테이지** | builder → runner | builder → runner | deps → builder → runner | builder → runner |
| **캐시 전략** | pip 캐시 마운트 | cargo registry + target 캐시 | npm + .next 캐시 마운트 | pip + uv 캐시 |
| **의존성 분리** | pyproject.toml 파싱 | 빈 main.rs 트릭 | npm ci 분리 | uv pip 분리 |
| **실행 사용자** | app (UID 1000) | app (UID 1000) | nextjs (UID 1001) | app (UID 1000) |
| **포트** | 8000 | 8080 | 3000 | 8000 |

MCP Station은 특수한 케이스다. Python 기반이지만 MCP 서버를 실행하기 위해 Node.js(`npx`)도 필요하다. 그래서 Python 베이스 이미지 위에 Node.js를 추가 설치하는 하이브리드 구조를 사용한다.

### Dockerfile vs Dockerfile.local

대부분의 서비스에는 두 종류의 Dockerfile이 있다.

| | Dockerfile | Dockerfile.local |
|---|---|---|
| **의존성 설치** | `COPY . .` 후 `pip install .` | `COPY pyproject.toml .` 먼저 → deps 설치 → `COPY . .` |
| **캐시 효율** | 소스 변경 시 의존성도 재설치 | 소스 변경해도 의존성 캐시 유지 |
| **용도** | 범용 (GitLab clone 포함 가능) | Jenkins 반복 빌드 최적화 |

Jenkins 파이프라인은 `services.yaml` 설정에서 서비스별로 어떤 Dockerfile을 사용할지 지정한다.

```yaml
# k3s/jenkins/config/services.yaml
services:
  xgen-core:
    repo: "xgen-core"
    dockerfile: "dockerfiles/xgen-python/Dockerfile.local"
    port: 8000
    healthCheck: "/health"
  xgen-backend-gateway:
    repo: "xgen-backend-gateway"
    dockerfile: "dockerfiles/xgen-backend-gateway/Dockerfile"
    port: 8000
    healthCheck: "/health"
```

Rust Gateway는 `Dockerfile`(일반)을 사용한다. 앞서 설명했듯이 Cargo.toml만으로 의존성 빌드가 가능하므로, `.local` 변형이 불필요하기 때문이다.

---

## Docker Compose 인프라 스택

XGEN의 인프라 서비스(PostgreSQL, Redis, Qdrant, MinIO)는 K8s 안이 아니라 호스트의 Docker Compose로 실행된다. StatefulSet으로 DB를 K8s 안에 넣으면 운영 복잡도가 올라가기 때문에, 현재 규모에서는 Docker Compose가 더 합리적인 선택이다.

### k3s-infra 스택

프로덕션에서 실제로 사용하는 파일이다.

```yaml
# compose/k3s-infra/docker-compose.yml
services:
  postgresql:
    image: postgres:15.4
    container_name: postgresql
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgre-data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "${POSTGRES_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - xgen-infra

  redis:
    image: redis:8.0-alpine
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --maxmemory 2gb
      --maxmemory-policy allkeys-lru
      --bind 0.0.0.0
    volumes:
      - redis-data:/data
    ports:
      - "${REDIS_PORT}:6379"
    restart: unless-stopped
    networks:
      - xgen-infra

  qdrant:
    image: qdrant/qdrant:v1.13.2
    volumes:
      - qdrant-data:/qdrant/storage
      - ./qdrant-config.yaml:/qdrant/config/production.yaml
    ports:
      - "${QDRANT_HTTP_PORT}:6333"
      - "${QDRANT_GRPC_PORT}:6334"
    restart: unless-stopped
    networks:
      - xgen-infra

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio-data:/data
    ports:
      - "${MINIO_API_PORT}:9000"
      - "${MINIO_CONSOLE_PORT}:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - xgen-infra
```

각 서비스의 설계 의도를 정리한다.

**PostgreSQL**: `init-scripts` 디렉토리를 마운트하여, 최초 실행 시 테이블 생성 SQL을 자동 실행한다. `pg_isready` 헬스체크로 다른 서비스가 DB 준비 상태를 확인할 수 있다.

**Redis**: `allkeys-lru` 정책으로 메모리 2GB 제한 내에서 LRU 캐시처럼 동작한다. `appendonly yes`로 AOF 영속화를 활성화하여 재시작 시에도 데이터를 유지한다.

**Qdrant**: 벡터 데이터베이스. HTTP(6333)와 gRPC(6334) 두 포트를 노출한다. gRPC는 대량 벡터 연산 시 성능이 좋다.

**MinIO**: S3 호환 오브젝트 스토리지. 문서 파일 저장에 사용한다. 별도의 init 컨테이너(`minio-init`)가 최초 실행 시 `documents` 버킷을 자동 생성한다.

`restart: unless-stopped`로 서버 재부팅 시에도 자동으로 올라온다. 수동으로 `docker stop`한 경우만 재시작하지 않는다.

### 볼륨 마운트 전략

```yaml
volumes:
  postgre-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/postgre-data
```

Docker named volume을 호스트의 `/data/` 디렉토리에 바인드한다. 컨테이너를 삭제해도 데이터는 호스트 디스크에 그대로 남는다. 서버의 SSD가 별도 파티션이라면 `/data/`를 해당 디스크에 마운트하여 I/O 성능을 확보할 수 있다.

### full-stack Compose

`compose/full-stack/docker-compose.yml`은 K8s 없이 Docker Compose만으로 전체 스택을 실행하는 구성이다. 외부 고객사에 K8s 없이 납품하거나, 로컬 개발 환경에서 사용한다.

```yaml
# compose/full-stack/docker-compose.yml (일부)
xgen-core:
  image: ${DOCKER_REGISTRY}/xgen-core:${IMAGE_TAG}
  build:
    context: ../xgen-python
    dockerfile: Dockerfile.git
    args:
      GIT_REPO: https://sonsj97:${GITLAB_TOKEN}@gitlab.x2bee.com/xgen2.0/xgen-core.git
      GIT_BRANCH: ${GIT_BRANCH:-main}
  depends_on:
    postgresql:
      condition: service_healthy
    redis:
      condition: service_healthy
  deploy:
    resources:
      limits:
        memory: 2G
```

`Dockerfile.git`을 사용하여 빌드 시 GitLab에서 직접 소스를 clone한다. Jenkins 없이 `docker compose build` 한 방으로 전체 빌드가 가능하다. `depends_on`의 `condition: service_healthy`로 DB가 준비된 후에야 앱 서비스가 시작된다.

두 Compose 파일의 역할을 정리하면 이렇다.

```
k3s-infra (프로덕션):
  "DB/Redis만 Docker로, 앱은 K8s가 관리"
  → docker compose up -d로 인프라만 올림
  → K8s가 External Services로 연결

full-stack (단독 배포):
  "K8s 없이 Docker Compose만으로 전체 스택 실행"
  → docker compose up -d 한 방으로 전체 기동
  → 고객사 납품, 로컬 개발용
```

---

## K8s와 Docker의 경계 연결

K3s 안의 앱 서비스가 K3s 밖의 Docker Compose 인프라에 접근하려면, 경계를 연결하는 장치가 필요하다. 이 역할을 하는 것이 `external-services.yaml`의 Service + Endpoints 패턴이다.

```yaml
# k3s/cluster/k8s/infra/external-services.yaml
---
apiVersion: v1
kind: Service
metadata:
  name: postgresql
  namespace: xgen-system
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Endpoints
metadata:
  name: postgresql    # Service와 이름이 같아야 함
  namespace: xgen-system
subsets:
  - addresses:
      - ip: __HOST_IP__    # setup-k3s.sh가 실제 IP로 치환
    ports:
      - port: 5432
```

일반적인 Service는 `selector`로 Pod을 자동으로 찾지만, 여기서는 selector 없이 Endpoints를 수동으로 지정한다. `__HOST_IP__`는 설치 스크립트(`setup-k3s.sh`)가 호스트의 실제 IP(예: `203.0.113.1`)로 치환한다.

```mermaid
flowchart LR
    A[xgen-core Pod] -->|postgresql.xgen-system<br/>.svc.cluster.local:5432| B[Service<br/>ClusterIP]
    B -->|Endpoints| C[203.0.113.1:5432]
    C --> D[Docker Compose<br/>PostgreSQL 컨테이너]
```

이 패턴의 장점은 **앱 코드가 인프라 위치를 모른다**는 것이다. 모든 서비스는 `postgresql.xgen-system.svc.cluster.local`이라는 K8s 내부 DNS 이름으로 DB에 접근한다. DB 서버를 다른 머신으로 옮기거나 AWS RDS로 전환하더라도, Endpoints의 IP만 바꾸면 된다. 앱 코드, ConfigMap, Helm values는 수정할 필요가 없다.

```yaml
# DB를 별도 서버로 이전할 때 — Endpoints IP만 변경
subsets:
  - addresses:
      - ip: 10.0.1.100    # 새 DB 서버 IP
    ports:
      - port: 5432
```

현재 4개 인프라 서비스(PostgreSQL, Redis, Qdrant, MinIO)가 이 패턴으로 연결되어 있다.

```
kubectl get endpoints -n xgen-system

NAME         ENDPOINTS
postgresql   203.0.113.1:5432
redis        203.0.113.1:6379
qdrant       203.0.113.1:6333, 203.0.113.1:6334
minio        203.0.113.1:9000, 203.0.113.1:9001
```

---

## 네임스페이스 구조

K3s 클러스터의 네임스페이스는 역할별로 분리되어 있다.

| 네임스페이스 | 역할 | 주요 리소스 |
|-------------|------|-----------|
| `xgen` | 앱 서비스 | 6개 마이크로서비스 Deployment |
| `xgen-system` | 인프라 연결 | External Services (DB, Redis, Qdrant, MinIO) |
| `argocd` | GitOps 배포 | ArgoCD Server, Repo Server |
| `jenkins` | CI/CD 빌드 | Jenkins Controller |
| `observability` | 모니터링 | Prometheus, Grafana, Loki, Tempo |
| `istio-system` | 서비스 메시 | Istio IngressGateway, istiod |
| `registry` | 이미지 저장 | Docker Registry (localhost:30500) |

`xgen`과 `xgen-system`을 분리한 이유가 있다. 인프라 서비스의 Service/Endpoints는 앱과 라이프사이클이 다르다. 앱 네임스페이스를 날려도 인프라 연결은 유지되어야 하고, 반대로 인프라 서버를 교체해도 앱에는 영향이 없어야 한다.

---

## 정리

1편에서 다룬 내용을 정리한다.

- XGEN 인프라는 **빌드(Jenkins) → 배포(ArgoCD) → 실행(K3s + Docker Compose)** 3계층으로 구성된다.
- 4종 언어별 Dockerfile은 모두 **멀티스테이지 빌드**를 사용하며, 각 언어 특성에 맞는 **캐시 최적화 전략**을 적용했다.
- 인프라 서비스(DB, 캐시)는 **Docker Compose**로 호스트에서 실행하고, **External Services 패턴**으로 K8s 내부에서 접근한다.
- 모든 설정은 **단일 레포지토리**(xgen-infra)에서 관리하며, **설정과 로직의 분리** 원칙을 따른다.

2편에서는 K3s 클러스터 안의 Kubernetes 오브젝트들 — Pod, Deployment, Service, ConfigMap, HPA — 이 어떻게 구성되어 있고, 스케일링과 무중단 배포가 어떻게 동작하는지 분석한다.
