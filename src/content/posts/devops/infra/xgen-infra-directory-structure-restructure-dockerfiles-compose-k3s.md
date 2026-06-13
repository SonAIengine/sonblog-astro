---
title: '인프라 모노레포 디렉토리 구조 설계: dockerfiles/compose/k3s 분리 전략'
description: 하나의 레포에 혼재하던 Dockerfile, Docker Compose, K3s 쿠버네티스 매니페스트를 역할별로 분리하고 ArgoCD와
  연동하는 인프라 모노레포 구조 리팩토링 과정.
pubDatetime: 2026-02-09
tags:
- DevOps
- K3s
- Docker
- ArgoCD
- 인프라
- 리팩토링
- 도커
- 쿠버네티스
---


## 배경

XGEN 2.0 인프라 레포지토리는 초기에 빠르게 만들다 보니 디렉토리 구조가 뒤죽박죽이 됐다. Dockerfile과 docker-compose.yml과 K3s Helm chart가 같은 레벨에 뒤섞여 있었고, 새로운 사람이 레포를 처음 보면 "어디서 뭘 수정해야 하는지" 파악하는 데 시간이 걸렸다.

```
# 재편성 전 (혼재 상태)
xgen-infra/
├── docker/           # Dockerfile들
│   ├── xgen-python/
│   ├── xgen-frontend/
│   └── xgen-backend-gateway/
├── compose/          # docker-compose
│   ├── infra/        # infra 용도가 불명확
│   └── infra-only/   # 뭔가 있는 것 같은데...
├── helm-chart/
├── argocd/
│   └── apps/         # 개별 Application YAML 20개
├── pipeline/
├── observability/
└── k3s/
```

`infra`와 `infra-only`는 이름만 봐서는 차이를 알 수 없었다. `argocd/apps/` 아래는 서비스별 Application YAML 파일이 20개가 넘었다. 처음 보는 사람은 어느 파일을 수정해야 하는지 알 수 없는 상태였다.

## 1차 재편성: docker 디렉토리 이름 정리 (2026-01-17)

```bash
# # 커밋: docker 디렉토리명 변경: infra→infra-only, deploy→full-stack (직관성 개선)
# # 날짜: 2026-01-17
```

`compose/infra` → `compose/infra-only`로 이름 변경부터 시작했다. "infra만 실행한다"는 의미를 명확히 하기 위해서였다. docker-compose로 실행 목적이 두 가지였다.

- `full-stack`: 모든 서비스(xgen-model, xgen-core, xgen-workflow, xgen-frontend, xgen-backend-gateway)를 Docker Compose로 실행. 개발/테스트 환경.
- `infra-only`: PostgreSQL, Redis, Qdrant, MinIO 같은 인프라 컴포넌트만 실행. K3s 클러스터가 이걸 참조.

이름이 명확해지자 용도 파악이 훨씬 쉬워졌다.

## 2차 재편성: 전면 구조 개편 (2026-02-09)

```bash
# # 커밋: refactor: 디렉토리 구조 재편성 (dockerfiles/compose/k3s 분리)
# # 날짜: 2026-02-09
```

1차 이름 변경으로는 부족했다. 더 근본적인 문제는 "Dockerfile 빌드 정의"와 "배포 방식(Compose vs K3s)"이 분리되지 않았다는 점이었다.

```
# 재편성 후 (역할별 분리)
xgen-infra/
├── dockerfiles/          # Dockerfile 모음 (빌드 정의만)
│   ├── xgen-python/
│   │   ├── Dockerfile
│   │   └── Dockerfile.local
│   ├── xgen-frontend/
│   │   ├── Dockerfile
│   │   └── Dockerfile.local
│   └── xgen-backend-gateway/
│       ├── Dockerfile
│       └── Dockerfile.local
│
├── compose/              # Docker Compose 배포
│   ├── full-stack/       # 전체 서비스 로컬 실행
│   │   └── docker-compose.yml
│   └── k3s-infra/        # K3s가 필요한 인프라 컴포넌트
│       ├── docker-compose.yml
│       └── .env.example
│
├── k3s/                  # K3s 쿠버네티스 배포 (모두 여기)
│   ├── helm-chart/
│   │   ├── charts/
│   │   └── values/
│   ├── argocd/
│   │   └── projects/     # ApplicationSet/Project (apps/ 삭제)
│   ├── jenkins/
│   │   └── casc-config.yaml
│   ├── pipeline/
│   │   └── Jenkinsfile.*
│   └── observability/
│       ├── prometheus/
│       ├── grafana/
│       └── loki/
│
└── docs/
    ├── deploy-guide.md
    └── reference/
```

### dockerfiles/ 분리의 의미

Dockerfile을 별도 디렉토리로 분리하면 CI 파이프라인에서 컨텍스트를 명시적으로 지정할 수 있다.

```groovy
// Jenkinsfile
sh """
    docker build \
        -f ${WORKSPACE}/dockerfiles/${SERVICE_NAME}/Dockerfile \
        -t ${REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG} \
        ${SOURCE_DIR}
"""
```

빌드 컨텍스트(소스코드)와 Dockerfile 위치를 분리하면, 소스코드를 어디서 체크아웃했든 동일한 Dockerfile을 참조할 수 있다.

`Dockerfile.local`은 개발 환경용이다. GitLab에서 직접 clone하는 대신 로컬 소스코드를 마운트해서 빠르게 이터레이션할 수 있다.

```dockerfile
# Dockerfile.local (개발용)
FROM python:3.11-slim
WORKDIR /app
# pyproject.toml에서 deps 추출 (레이어 캐시 최적화)
COPY pyproject.toml .
RUN python3 -c "import tomllib; ..."
COPY . .
CMD ["uvicorn", "main:app", "--reload", "--host", "0.0.0.0"]
```

```dockerfile
# Dockerfile (프로덕션용)
FROM python:3.11-slim
# GitLab에서 직접 clone
ARG GITLAB_TOKEN
RUN git clone https://oauth2:${GITLAB_TOKEN}@gitlab.x2bee.com/...
```

### argocd/apps/ 삭제: ApplicationSet으로 통합

```bash
# # 커밋: refactor: ApplicationSet 제거, 개별 Application 파일 방식으로 통일
# # 날짜: 2026-02-16
# # 커밋: refactor: Jenkins/ArgoCD 디렉토리 구조 개편
# # 날짜: 2026-02-16
```

초기에는 `argocd/apps/` 아래에 서비스별 Application YAML이 20개 넘게 있었다.

```
argocd/apps/
├── xgen-core-dev.yaml
├── xgen-core-prd.yaml
├── xgen-workflow-dev.yaml
├── xgen-workflow-prd.yaml
├── xgen-model-dev.yaml
├── xgen-model-prd.yaml
...   (20개 이상)
```

서비스가 추가될 때마다 2개씩 파일이 늘었고, 공통 설정(syncPolicy, project, destination)을 20개 파일에서 모두 수동으로 관리했다.

이를 `projects/*.yaml` 구조로 단일화했다.

```yaml
# k3s/argocd/projects/xgen.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: xgen-services
  namespace: argocd
spec:
  generators:
  - list:
      elements:
      - service: xgen-core
        env: dev
        domain: xgen.x2bee.com
      - service: xgen-core
        env: prd
        domain: jeju-xgen.x2bee.com
      - service: xgen-workflow
        env: dev
        domain: xgen.x2bee.com
      # ... 서비스 목록만 여기서 관리
  template:
    metadata:
      name: "{{service}}-{{env}}"
    spec:
      project: xgen
      source:
        repoURL: https://gitlab.x2bee.com/xgen2.0/xgen-infra.git
        path: "k3s/helm-chart/charts/{{service}}"
        helm:
          valueFiles:
          - "../../../values/{{service}}.yaml"
          - "../../../values/{{service}}-{{env}}.yaml"
      destination:
        server: https://kubernetes.default.svc
        namespace: "xgen-{{env}}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

서비스 추가 시 `elements` 리스트에 항목 하나만 추가하면 된다. 공통 syncPolicy나 source 설정은 template에서 한 번만 관리한다.

## k3s/ 하위로 Jenkins/Observability 통합

```bash
# # 커밋: refactor: Jenkins/ArgoCD 디렉토리 구조 개편 (k3s/ 하위로 통합)
# # 날짜: 2026-02-16
```

`pipeline/`과 `observability/`가 루트에 따로 있었는데, 이것들은 모두 K3s 클러스터 위에서 동작하는 컴포넌트다. `k3s/` 하위로 통합하면 "K3s 클러스터 관련 설정은 모두 k3s/ 아래"라는 원칙이 생긴다.

```
# 통합 전
xgen-infra/
├── pipeline/   # Jenkins 파이프라인
├── observability/  # Prometheus, Grafana
└── k3s/

# 통합 후
xgen-infra/
└── k3s/
    ├── jenkins/      # Jenkins 설정 + 파이프라인
    ├── observability/ # Prometheus, Grafana, Loki
    └── ...
```

## 문서 경로 업데이트

```bash
# # 커밋: docs: 디렉토리 구조 변경에 따른 전체 문서 경로 업데이트
# # 날짜: 2026-02-09
```

구조를 바꾸면 기존 문서의 경로 참조가 다 틀려진다. 배포 가이드, README 등 20개 이상의 문서에서 경로를 일괄 수정했다.

이 작업을 빠뜨리면 가이드 문서를 보고 실제 파일을 찾으려 할 때 혼란이 생긴다. 구조 변경과 문서 업데이트는 반드시 같은 커밋이나 연속 커밋으로 처리해야 한다.

## 구조 설계 원칙

이번 재편성에서 정리한 원칙이다.

**1. 역할 기반 분리**: "무엇을 하는가"가 디렉토리 이름에 드러나야 한다. `dockerfiles/`는 빌드 정의, `compose/`는 Compose 배포, `k3s/`는 K3s 배포.

**2. 단일 책임**: 한 디렉토리는 한 가지 목적만. `compose/`에 Helm chart가 있으면 안 된다.

**3. 이름의 직관성**: `infra-only` 같은 접미사보다 `k3s-infra` 같이 컨텍스트가 드러나는 이름이 낫다.

**4. 신규 진입자 기준**: 레포를 처음 보는 사람이 5분 안에 파악할 수 있어야 한다. 이를 테스트하는 방법은 동료에게 "이 레포에서 xgen-core 배포 설정을 찾아보세요"라고 물어보는 것이다.

## 결과

- 디렉토리 구조만 보고도 용도 파악 가능
- argocd/apps/ 20개 파일 → projects/xgen.yaml 1개로 통합
- 신규 서비스 추가: 이전에는 YAML 2개 생성 + 복붙 → 지금은 `elements` 항목 1개 추가
- Dockerfile 변경이 compose와 k3s에 모두 자동 반영 (공유 dockerfiles/ 참조)

인프라 코드도 앱 코드와 같은 리팩토링 원칙이 적용된다. 기능이 동일해도 구조가 명확하면 유지보수 비용이 줄어든다.
