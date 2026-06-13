---
title: XGEN AWS EKS 신규 고객사 배포기 — 온프레미스에서 클라우드로
description: 온프레미스 K3s에서 운영하던 XGEN 2.0 플랫폼을 AWS EKS 기반 신규 고객사 환경에 배포한 과정을 정리한다. 멀티
  고객사 아키텍처가 실제로 통하는지 검증하고, 레지스트리 분리, MinIO에서 S3 전환, 하드코딩 제거까지 트러블슈팅 과정을 기록한다.
pubDatetime: 2026-02-20
tags:
- AWS
- EKS
- ArgoCD
- Jenkins
- Kubernetes
- Nexus
- S3
- XGEN
- GitOps
- 멀티테넌시
- 쿠버네티스
- 클라우드
- DevOps
---


## 배경 — "yaml 하나면 끝"이 진짜인가

XGEN 2.0은 AI Agent 플랫폼이다. 지금까지는 온프레미스 K3s 클러스터에서 운영했고, 고객사(롯데홈쇼핑 등)에도 같은 온프레미스 구조로 배포했다. 이전 글 "[ArgoCD 멀티 고객사 배포 아키텍처](argocd-multi-client-site-deploy-architecture-applicationset-trial-error-single-entry-point-design.md)"에서 `projects/*.yaml` 단일 진입점 구조를 만들었고, 당시 결론은 이랬다:

> 새 고객사 추가: `projects/newcustomer.yaml` 하나 만들고, Root App yaml 하나 등록하면 끝

그런데 새로운 고객사(이하 AWW)는 상황이 달랐다. **AWS 위에서 EKS로 운영해야 했다.** 지금까지 온프레미스끼리만 배포했는데, 처음으로 클라우드 환경이 들어온 것이다.

온프레미스와 AWS의 차이점은 생각보다 많았다:

- **이미지 레지스트리**: 온프레미스 Nexus가 아니라 AWS 내부 Nexus를 써야 한다
- **오브젝트 스토리지**: 자체 MinIO 대신 AWS S3를 사용해야 한다
- **Git 레포지토리**: 온프레미스 GitLab이 아니라 AWS 내부 GitLab에서 ArgoCD가 소스를 가져온다
- **인프라 서비스**: PostgreSQL, Redis, Qdrant가 별도 관리 서버에서 Docker Compose로 운영되고, EKS와 VPC Peering으로 연결된다
- **빌드 파이프라인**: 온프레미스 Jenkins에서 빌드하되, 이미지는 AWS Nexus로 push해야 한다

"yaml 하나면 끝"이 정말 통하는지, 아키텍처의 첫 실전 테스트가 시작됐다.

## AWW 배포 아키텍처

```mermaid
flowchart LR
    subgraph OnPrem["온프레미스"]
        Jenkins["Jenkins<br/>빌드 서버"]
        GitLab["GitLab<br/>소스 저장소"]
    end

    subgraph AWS["AWS ap-northeast-2"]
        subgraph EKS["EKS Cluster"]
            ArgoCD["ArgoCD"]
            FE["xgen-frontend"]
            GW["xgen-backend-gateway"]
            Core["xgen-core"]
            WF["xgen-workflow"]
            Doc["xgen-documents"]
            MCP["xgen-mcp-station"]
        end

        AWSGitLab["AWS GitLab<br/>ArgoCD 소스"]
        AWSNexus["AWS Nexus<br/>이미지 레지스트리"]
        S3["S3 Bucket"]

        subgraph MgmtServer["관리 서버"]
            PG["PostgreSQL"]
            Redis["Redis"]
            Qdrant["Qdrant"]
        end
    end

    Jenkins -->|"docker push"| AWSNexus
    GitLab -->|"git mirror"| AWSGitLab
    ArgoCD -->|"git poll"| AWSGitLab
    ArgoCD -->|"deploy"| FE
    ArgoCD -->|"deploy"| GW
    ArgoCD -->|"deploy"| Core
    ArgoCD -->|"deploy"| WF
    ArgoCD -->|"deploy"| Doc
    ArgoCD -->|"deploy"| MCP
    EKS <-->|"VPC Peering"| MgmtServer
    Doc -->|"문서 저장"| S3
```

핵심 포인트는 **빌드는 온프레미스, 배포는 AWS**라는 이중 구조다. AWS에 별도 Jenkins가 있었지만 XGEN 전용이 아니어서 사용할 수 없었다. 온프레미스 Jenkins에서 이미지를 빌드하고 AWS Nexus로 push하는 구조를 택했다.

## EKS 환경 부트스트랩

yaml 파일을 만들기 전에, EKS 클러스터에 XGEN이 올라갈 수 있는 기반부터 만들어야 했다. 온프레미스 K3s에서는 클러스터 세팅 스크립트(`setup-k3s.sh`)가 이 과정을 자동화하지만, EKS는 처음이라 하나씩 수작업으로 진행했다.

### kubeconfig 컨텍스트 분리

온프레미스 K3s와 AWS EKS를 동시에 다뤄야 하니, kubeconfig 컨텍스트를 분리하는 게 첫 번째 작업이었다. 실수로 온프레미스 클러스터에 AWW 설정을 배포하면 사고가 나기 때문이다.

```bash
# EKS 클러스터 kubeconfig 추가
aws eks update-kubeconfig \
  --region ap-northeast-2 \
  --name prd-x2bee-eks-cluster \
  --alias eks-aww \
  --profile aww

# 컨텍스트 확인 — 온프레미스와 EKS가 공존
kubectl config get-contexts
# CURRENT   NAME       CLUSTER
#           default    default         ← 온프레미스 K3s (243)
#           dev        default         ← 온프레미스 K3s (244)
# *         eks-aww    prd-x2bee-eks   ← AWS EKS
```

이후 모든 EKS 작업에는 `--context eks-aww`를 명시하거나, `KUBECONFIG`을 분리해서 사용했다.

### 네임스페이스와 Secret 생성

EKS에 XGEN 서비스가 올라갈 네임스페이스와, 서비스가 의존하는 Secret을 먼저 만들어야 한다:

```bash
# 네임스페이스 생성
kubectl --context eks-aww create namespace xgen

# 이미지 pull용 Secret (AWS Nexus 인증)
kubectl --context eks-aww -n xgen create secret docker-registry registry-credentials \
  --docker-server=<aww-nexus-host>:5000 \
  --docker-username=admin \
  --docker-password='<nexus-password>'

# 인프라 접속 정보 Secret (DB, Redis 등)
kubectl --context eks-aww -n xgen create secret generic xgen-secrets \
  --from-literal=POSTGRES_USER=<db-user> \
  --from-literal=POSTGRES_PASSWORD='<db-password>' \
  --from-literal=REDIS_PASSWORD='<redis-password>' \
  --from-literal=MINIO_DATA_ACCESS_KEY='<s3-access-key>' \
  --from-literal=MINIO_DATA_SECRET_KEY='<s3-secret-key>'
```

이 Secret들은 Git에 없다. `projects/*.yaml`이 아무리 잘 설계되어 있어도, Secret은 배포 시점에 수동으로 넣어야 하는 영역이다.

### 방화벽 IP 화이트리스트

AWS 환경은 화이트리스트 기반 방화벽이었다. 통신이 필요한 구간마다 IP 개방을 요청해야 했다:

| 구간 | 용도 | 포트 |
|------|------|------|
| 온프레미스 Jenkins → AWS Nexus | 이미지 push | 5000 |
| EKS Pod → 관리 서버 | DB, Redis, Qdrant 접속 | 5432, 6379, 6333 |
| 온프레미스 GitLab → AWS GitLab | Git 미러링 | 8083 |

특히 Jenkins → Nexus 구간이 막혀 있으면 이미지 빌드는 성공하지만 push에서 타임아웃이 난다. 이 부분은 고객사 인프라 담당자에게 개방 요청을 넣고 확인받아야 해서, 코드 작업과 별개로 리드타임이 있었다.

### ArgoCD 연동 — Git 레포 등록과 Root App

EKS에 ArgoCD가 이미 설치되어 있었다. 여기에 XGEN 인프라 레포를 연결하고, Root App을 등록하는 과정:

```bash
# ArgoCD에 AWS GitLab 레포 등록
argocd repo add http://<aws-gitlab-host>/xgen/xgen-infra.git \
  --username root \
  --password '<gitlab-password>'

# Root App 등록 — 이 한 줄이 6개 서비스 Application을 자동 생성한다
kubectl --context eks-aww apply -f k3s/argocd/root-apps/aww-root.yaml
```

Root App이 등록되면 ArgoCD가 `projects/xgen-aww.yaml`을 읽어서 6개 서비스의 Application을 자동으로 만든다. 여기서부터는 기존 아키텍처가 동작하는 영역이다.

### 인프라 연결 확인

마지막으로, EKS Pod에서 관리 서버(PostgreSQL, Redis, Qdrant)에 실제로 접근할 수 있는지 확인했다. VPC Peering이 설정되어 있어도 실제 통신이 되는지는 별개 문제다:

```bash
# EKS에서 임시 Pod로 관리 서버 연결 테스트
kubectl --context eks-aww -n xgen run test-conn --rm -it --image=busybox -- sh
/ # nc -zv <mgmt-server-ip> 5432    # PostgreSQL
/ # nc -zv <mgmt-server-ip> 6379    # Redis
/ # nc -zv <mgmt-server-ip> 6333    # Qdrant
```

여기까지가 "XGEN yaml을 작성하기 전에 해야 하는 일"이다. 온프레미스에서는 스크립트 하나로 끝나는 과정이 AWS에서는 kubeconfig 분리, Secret 생성, 방화벽 개방, ArgoCD 연동, 네트워크 확인까지 수작업으로 이어진다. 클라우드 배포의 진짜 비용은 yaml이 아니라 이 부트스트랩 과정에 있다.

## 통한 것 — xgen-aww.yaml 단일 진입점

결론부터 말하면, 큰 틀에서는 통했다. `projects/xgen-aww.yaml` 파일 하나에 AWW 환경의 모든 배포 설정을 정의할 수 있었다:

```yaml
# k3s/argocd/projects/xgen-aww.yaml
project:
  name: xgen
  description: "xgen2.0 Platform (AWW)"
  namespace: xgen

source:
  repoURL: http://<aws-gitlab-host>/xgen/xgen-infra.git  # AWS 내부 GitLab
  targetRevision: main

destinations:
  aww:
    server: https://kubernetes.default.svc
    domain: ""

site: aww
registryHost: "<aws-nexus-host>:5000"

vars:
  APP_SITE: "xgen-aww"
  AWS_REGION: "ap-northeast-2"
  S3_BUCKET: "xgen-aww"
  S3_DOCUMENT_BUCKET: "xgen-aww"

infra:
  postgres:
    host: "<mgmt-server-ip>"
  redis:
    host: "<mgmt-server-ip>"
  qdrant:
    host: "<mgmt-server-ip>"
  minio:
    endpoint: ""  # S3 사용, MinIO 불필요

environments:
  aww:
    services:
      - name: xgen-frontend
        hasDomain: true
        replicas: 1
        autoscaling: { minReplicas: 1, maxReplicas: 2 }
        resources:
          requests: { memory: "256Mi", cpu: "100m" }
          limits:   { memory: "1Gi",   cpu: "500m" }
      # ... 6개 서비스 정의
```

```
# 커밋: feat: AWW EKS 배포용 ArgoCD 프로젝트 설정 추가
# 날짜: 2026-02-20 18:18
```

온프레미스 `xgen.yaml`과 비교하면 차이점이 명확하다:

| 항목 | xgen.yaml (온프레미스) | xgen-aww.yaml (AWS) |
|------|----------------------|---------------------|
| source.repoURL | 온프레미스 GitLab | AWS 내부 GitLab |
| registryHost | 미설정 (기본값) | AWS Nexus 주소 |
| infra | 빈 값 (K3s 내장) | 관리 서버 IP |
| minio.endpoint | 빈 값 (K3s MinIO) | S3 엔드포인트 |
| vars | APP_SITE만 | S3 버킷 + 리전 추가 |

`source`, `infra`, `vars` 같은 섹션이 이미 설계되어 있어서, 값만 채우면 동작하는 구조였다. 아키텍처 설계 단계에서 "고객사별로 다를 수 있는 것"을 변수로 뽑아놓은 게 여기서 빛을 발했다.

하지만 **그 변수가 충분하지 않았다.** 온프레미스끼리만 배포하다 보니, "당연히 같을 거라고 전제한 것"들이 있었다. 여기서부터가 트러블슈팅이다.

## 트러블슈팅 1 — 레지스트리가 하나뿐이다

### 증상

Jenkins에서 AWW용 이미지를 빌드한 후 push할 곳이 없었다. 기존 파이프라인은 Nexus 레지스트리 주소가 `project.yaml`에 하나만 정의되어 있었다:

```yaml
# k3s/jenkins/config/project.yaml (변경 전)
registry:
  nexus:
    host: "docker.x2bee.com"       # 모든 사이트가 이 하나를 공유
    credentialId: "nexus-credentials"
```

AWW 고객사는 자체 Nexus 레지스트리를 운영한다. 같은 `docker.x2bee.com`에 push할 수 없고, AWW 전용 레지스트리로 보내야 했다.

### 원인

멀티 고객사 구조를 만들 때, "레지스트리는 하나"라는 전제가 깔려 있었다. 온프레미스 고객사들은 전부 같은 Nexus를 공유했으니 문제가 안 됐는데, AWS 고객사는 물리적으로 다른 레지스트리를 쓴다.

### 해결 — siteRegistries 오버라이드

`project.yaml`에 사이트별 레지스트리 오버라이드 섹션을 추가했다:

```yaml
# k3s/jenkins/config/project.yaml
registry:
  nexus:
    host: "docker.x2bee.com"          # 기본값
    credentialId: "nexus-credentials"
  local:
    host: "localhost:30500"

sites:
  - main
  - lotteimall
  - aww

# 사이트별 레지스트리 오버라이드
# 여기에 없는 사이트는 registry.nexus 기본값 사용
siteRegistries:
  aww:
    host: "<aww-nexus-host>:5000"
    credentialId: "aww-nexus-credentials"
```

```
# 커밋: feat: AWW 사이트 배포 지원 (사이트별 Nexus 레지스트리 분리)
# 날짜: 2026-02-20 06:36
```

Jenkins 파이프라인에서 이 오버라이드를 처리하는 로직:

```groovy
// k3s/jenkins/build.groovy (Config 스테이지)
def projectConfig = readYaml file: 'k3s/jenkins/config/project.yaml'

// 사이트별 레지스트리 오버라이드 확인
def siteReg = projectConfig.siteRegistries?.get(params.SITE)
if (siteReg) {
    env.NEXUS_REGISTRY = siteReg.host
    env.NEXUS_CRED = siteReg.credentialId
} else {
    env.NEXUS_REGISTRY = projectConfig.registry.nexus.host
    env.NEXUS_CRED = projectConfig.registry.nexus.credentialId
}
```

`siteRegistries`에 해당 사이트가 있으면 그 레지스트리를 사용하고, 없으면 기본값을 쓴다. 기존 `main`이나 `lotteimall`은 `siteRegistries`에 엔트리가 없으므로 영향 없이 기본 레지스트리를 계속 사용한다. 이미지 경로도 자연스럽게 분리된다:

```
# 기존 (main 사이트)
docker.x2bee.com/xgen/main/xgen-frontend:latest-amd64

# AWW 사이트
<aww-nexus-host>:5000/xgen/aww/xgen-frontend:latest-amd64
```

## 트러블슈팅 2 — registryHost 파라미터가 없다

### 증상

Jenkins에서 AWW Nexus로 이미지를 push하는 건 해결했다. 그런데 ArgoCD 쪽에서 문제가 생겼다. EKS에 배포된 Pod가 이미지를 pull할 때, 레지스트리 호스트가 온프레미스 기본값(`docker.x2bee.com`)으로 잡혔다.

### 원인

기존 Helm 템플릿(`application.yaml`)은 `site`(이미지 경로의 사이트 부분)만 오버라이드할 수 있었다. 레지스트리 호스트 자체를 바꾸는 파라미터는 없었다. 온프레미스 고객사끼리는 호스트가 같으니 `site`만 바꾸면 됐는데, AWS는 호스트부터 다르다.

### 해결 — registryHost 파라미터 추가

ArgoCD Helm 템플릿에 `registryHost` 오버라이드를 추가했다:

```yaml
# k3s/argocd/templates/application.yaml (추가된 부분)
{{- if $.Values.site }}
- name: global.registry.site
  value: {{ $.Values.site | quote }}
{{- end }}
{{- if $.Values.registryHost }}
- name: global.registry.host
  value: {{ $.Values.registryHost | quote }}
{{- end }}
```

이제 `projects/xgen-aww.yaml`에서 `registryHost: "<aws-nexus-host>:5000"`을 선언하면, 해당 고객사의 모든 서비스가 AWS Nexus에서 이미지를 pull한다. 기존 고객사 yaml에는 `registryHost`가 없으므로 기본값(`docker.x2bee.com`)이 그대로 사용된다.

## 트러블슈팅 3 — MinIO 하드코딩이 S3에서 터졌다

이번 AWW 배포에서 가장 뼈아픈 문제였다.

### 증상

xgen-documents 서비스가 AWS 환경에서 파일 업로드/다운로드에 실패했다. S3 버킷에 접근하지 못하고, MinIO 관련 에러가 발생했다.

### 원인

xgen-documents는 `.env` 파일 기반으로 설정을 읽는 Python 앱이다. Kubernetes에서는 컨테이너 시작 시 `sed`로 `.env` 파일의 값을 오버라이드하는 방식을 썼는데, **MinIO 인증 정보가 하드코딩**되어 있었다:

```yaml
# k3s/helm-chart/values/xgen-documents.yaml (변경 전)
command:
  - /bin/sh
  - -c
  - |
    sed -i 's/MINIO_DATA_ACCESS_KEY=.*/MINIO_DATA_ACCESS_KEY=minio/' /app/.env
    sed -i 's/MINIO_DATA_SECRET_KEY=.*/MINIO_DATA_SECRET_KEY=minio123/' /app/.env
    sed -i 's|MINIO_ENDPOINT=.*|MINIO_ENDPOINT=http://minio.xgen-system.svc.cluster.local:9000|' /app/.env
    exec python main.py
```

온프레미스 MinIO 인증(`minio / minio123`)과 엔드포인트가 직접 박혀 있었다. 온프레미스에서는 이게 동작했지만, AWS S3에서는 IAM 키가 필요하고 엔드포인트도 다르다. 하드코딩이 환경 전환의 순간에 터진 것이다.

### 해결 방안 — 환경변수 참조로 전환 (미적용)

해결 방향은 명확하다. 고정값을 환경변수 참조로 바꾸면 된다:

```yaml
# k3s/helm-chart/values/xgen-documents.yaml (변경 계획)
command:
  - /bin/sh
  - -c
  - |
    sed -i "s|MINIO_ENDPOINT=.*|MINIO_ENDPOINT=${MINIO_ENDPOINT}|" /app/.env
    sed -i "s/MINIO_DATA_ACCESS_KEY=.*/MINIO_DATA_ACCESS_KEY=${MINIO_DATA_ACCESS_KEY}/" /app/.env
    sed -i "s/MINIO_DATA_SECRET_KEY=.*/MINIO_DATA_SECRET_KEY=${MINIO_DATA_SECRET_KEY}/" /app/.env
    sed -i "s/MINIO_DOCUMENT_BUCKET=.*/MINIO_DOCUMENT_BUCKET=${MINIO_DOCUMENT_BUCKET}/" /app/.env
    sed -i "s/MINIO_SECURE=.*/MINIO_SECURE=${MINIO_SECURE}/" /app/.env
    exec python main.py
```

변경 포인트:

- 작은따옴표(`'`) → 큰따옴표(`"`): 셸 변수 확장이 동작하도록
- 고정값(`minio`, `minio123`) → 환경변수 참조(`${MINIO_DATA_ACCESS_KEY}`)
- `MINIO_DOCUMENT_BUCKET`, `MINIO_SECURE` 추가: S3 사용 시 버킷명과 HTTPS 설정 필요

환경변수의 출처는 두 계층이다:

1. **ConfigMap** — `projects/xgen-aww.yaml`의 `vars` 섹션에서 `MINIO_DOCUMENT_BUCKET`, `MINIO_SECURE` 주입
2. **Secret** — `xgen-secrets`에서 `MINIO_DATA_ACCESS_KEY`, `MINIO_DATA_SECRET_KEY` 주입

> **현재 상태**: 이 수정은 아직 적용되지 않았다. AWW 배포에서는 xgen-documents의 파일 스토리지 기능을 사용하지 않아 당장 문제가 되지 않지만, S3 연동 시 반드시 적용해야 한다. `xgen-aww.yaml`의 `vars`에 `MINIO_DOCUMENT_BUCKET`, `MINIO_SECURE`를 추가하고, `infra.minio.endpoint`를 S3 엔드포인트로 설정하는 작업도 함께 필요하다.

### S3 연동 — MinIO SDK의 호환성

xgen-documents는 MinIO SDK를 사용하는데, MinIO SDK는 S3 호환이다. 따라서 **코드 수정 없이** 엔드포인트와 인증 정보만 바꾸면 S3와 통신할 수 있다:

```yaml
# xgen-aww.yaml에 추가 예정
infra:
  minio:
    endpoint: "https://s3.ap-northeast-2.amazonaws.com"

vars:
  MINIO_DOCUMENT_BUCKET: "xgen-aww"
  MINIO_SECURE: "true"  # 빠뜨리면 HTTP로 S3에 접근하려다 실패
```

환경변수가 Pod까지 전달되는 흐름:

```
xgen-aww.yaml (vars/infra)
  → ArgoCD application.yaml 템플릿 (helm parameters로 변환)
    → 서비스별 Helm 차트 (ConfigMap/Secret 생성)
      → Pod 환경변수로 주입
        → xgen-documents의 sed 스크립트가 .env 파일에 반영
```

## 트러블슈팅 4 — 리소스 과할당

### 증상

AWW EKS에 6개 서비스를 배포했는데, 노드 리소스를 과하게 점유했다. 초기 트래픽이 거의 없는 상태에서 불필요한 비용이 발생했다.

### 원인

온프레미스 prd 설정(`replicas: 2, minReplicas: 2, maxReplicas: 4`)을 그대로 복사해서 가져왔다. 온프레미스는 자체 서버니까 replicas 2가 부담이 아니지만, EKS는 노드 수 = 비용이다.

```
# 커밋: feat: AWW 리소스 설정 조정 (replicas 2→1)
# 날짜: 2026-02-20 20:04
```

### 해결 — replicas 축소 + autoscaling 재설정

모든 서비스를 `replicas: 1, minReplicas: 1, maxReplicas: 2`로 조정했다:

```
# 커밋: fix: AWW autoscaling minReplicas 1로 설정
# 날짜: 2026-02-20 20:10
```

```yaml
# xgen-aww.yaml (최종 리소스 설정)
environments:
  aww:
    services:
      - name: xgen-frontend
        replicas: 1
        autoscaling: { minReplicas: 1, maxReplicas: 2 }
        resources:
          requests: { memory: "256Mi", cpu: "100m" }
          limits:   { memory: "1Gi",   cpu: "500m" }

      - name: xgen-core
        replicas: 1
        autoscaling: { minReplicas: 1, maxReplicas: 2 }
        resources:
          requests: { memory: "512Mi", cpu: "200m" }
          limits:   { memory: "4Gi",   cpu: "1000m" }

      - name: xgen-documents
        replicas: 1
        autoscaling: { minReplicas: 1, maxReplicas: 2 }
        resources:
          requests: { memory: "1Gi",  cpu: "500m" }
          limits:   { memory: "16Gi", cpu: "4000m" }
      # ... 6개 서비스 모두 동일 패턴
```

평소에는 1개로 운영하되, 부하 시 2개까지 스케일아웃되는 구조다. 온프레미스 prd(`minReplicas: 2, maxReplicas: 4`)의 절반 수준이다.

## 배포 중 만난 함정

트러블슈팅 1~4는 아키텍처의 구멍이었다. 하지만 실제 배포 과정에서는 아키텍처와 무관한, **환경 차이에서 오는 함정**도 있었다.

### 함정 1 — YAML의 `!`가 태그로 해석된다 (serde_yaml)

가장 디버깅이 어려웠던 문제였다.

**증상**: xgen-backend-gateway가 EKS에서 "Name or service not known" DNS 에러를 냈다. `config.yml`에 인프라 IP(`10.100.1.70`)를 정확히 설정했는데, 마치 K8s 내부 DNS(`postgresql.xgen-system.svc.cluster.local`)를 찾는 것처럼 동작했다.

**원인**: 비밀번호에 `!` 문자가 있었다.

```yaml
# config/config.yml (문제 코드)
xgen-aww:
  development:
    REDIS_URL: redis://:AwwS0!ution@10.100.1.70:6379   # ← ! 문자
```

xgen-backend-gateway는 Rust 앱이고, `serde_yaml`로 YAML을 파싱한다. serde_yaml은 YAML 1.1 스펙을 따르는데, **`!`는 YAML 태그(tag) 지시자**다. `AwwS0!ution`의 `!ution`이 태그로 해석되면서 값 파싱이 실패했다.

문제는 **파싱 실패가 에러를 내지 않았다**는 것이다. backend-gateway의 설정 로직은 `APP_SITE`에 해당하는 섹션(`xgen-aww`)이 없으면 `default` 섹션으로 fallback하도록 구현되어 있다. `xgen-aww` 섹션 전체가 파싱 실패 → `default` 섹션(k8s 내부 DNS 주소) 사용 → DNS 에러.

```
config.yml 파싱 시도
  → xgen-aww 섹션의 !ution을 YAML 태그로 해석
  → 파싱 실패 (에러 로그 없음)
  → default 섹션 fallback
  → postgresql.xgen-system.svc.cluster.local로 접속 시도
  → DNS 에러
```

**해결**: URL 값을 따옴표로 감싸면 `!`가 문자열 리터럴로 처리된다.

```yaml
# config/config.yml (수정 후)
xgen-aww:
  development:
    REDIS_URL: "redis://:AwwS0!ution@10.100.1.70:6379"     # 따옴표로 감싸기
    DATABASE_URL: "postgresql://aww:AwwS0!ution@10.100.1.70:5432/plateerag"
```

이 문제는 온프레미스에서는 절대 발생하지 않는다. 온프레미스 비밀번호(`ailab123`, `redis_secure_password123!`)는 YAML 값 끝에 `!`가 오거나 따옴표로 이미 감싸져 있었다. AWW 비밀번호 `AwwS0!ution`의 `!`가 값 중간에 있어서 태그로 해석된 것이다.

### 함정 2 — 도메인이 없으면 Istio Gateway가 터진다

```
# 커밋: fix: domain 미설정 시 Istio Gateway/VirtualService 생성 방지
# 날짜: 2026-02-20
```

**증상**: xgen-frontend의 ArgoCD sync가 실패했다. 에러: `Gateway.networking.istio.io "xgen-frontend-gateway" is invalid: spec.servers[0].hosts: Required value`

**원인**: AWW에 도메인이 아직 확정되지 않아 빈 문자열(`""`)로 설정했다. Helm 템플릿이 빈 hosts 배열로 Gateway를 생성하려고 했고, Istio가 이를 거부했다.

**해결**: `ingress.yaml` 템플릿에 hosts가 비어있으면 Gateway/VirtualService를 아예 생성하지 않는 조건을 추가했다.

```yaml
# k3s/helm-chart/templates/ingress.yaml
{{- if .Values.ingress.enabled }}
{{- $hosts := fromYamlArray (include "xgen-service.ingressHosts" .) }}
{{- if $hosts }}       ← 이 조건 추가
...Gateway/VirtualService 생성...
{{- end }}
{{- end }}
```

온프레미스에서는 배포 시점에 항상 도메인이 있었으니 이 케이스를 고려하지 않았다. 클라우드 환경에서는 도메인 확정 전에 서비스부터 올리는 경우가 흔하다.

### 함정 3 — 환경마다 비밀번호가 다르다

**증상**: 모든 Python 서비스가 DB 접속에 실패했다. `password authentication failed for user "ailab"`

**원인**: xgen-secrets에 온프레미스 기본값(`ailab / ailab123`)을 넣었는데, AWW 인프라(10.100.1.70)의 PostgreSQL은 다른 계정(`aww / AwwS0!ution`)을 사용했다. "같은 XGEN 플랫폼이니까 DB 비밀번호도 같겠지"라는 가정이 틀렸다.

**해결**: AWW 인프라 관리 서버의 `.env` 파일을 확인하고, xgen-secrets를 정확한 값으로 재생성했다.

```bash
KUBECONFIG=~/.kube/config kubectl --context eks-aww -n xgen create secret generic xgen-secrets \
  --from-literal=POSTGRES_USER=aww \
  --from-literal=POSTGRES_PASSWORD='AwwS0!ution' \
  # ... (온프레미스 ailab/ailab123과 다름!)
```

이건 아키텍처 문제가 아니라 운영 문제다. Secret은 Git에 없으니 `projects/*.yaml`에서 관리할 수 없고, 배포 시점에 수동으로 넣어야 한다. 새 고객사 배포 체크리스트에 "인프라 비밀번호 확인"을 넣어야 한다.

## 선행 작업이 살렸다 — Nexus 인증 기반

AWW 트러블슈팅이 이 정도에서 끝난 건, 사실 선행 작업이 있었기 때문이다.

AWW 작업 전에 온프레미스 레지스트리를 `localhost:30500`(K3s 내장, 인증 없음)에서 `docker.x2bee.com`(Nexus, 인증 필요)으로 전환하면서 인증 기반을 다져놓았다:

```
# 커밋: fix: Nexus 인증 대응 - imagePullSecrets 추가
# 날짜: 2026-02-12 16:36
```

```
# 커밋: fix: Docker Registry를 Nexus(docker.x2bee.com)로 변경
# 날짜: 2026-02-17 17:36
```

Deployment 템플릿에 `imagePullSecrets`를 추가한 것이 핵심이다:

```yaml
# k3s/helm-chart/templates/deployment.yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: registry-credentials
      containers:
        - name: {{ include "xgen-service.name" . }}
          image: {{ include "xgen-service.image" . }}
```

이 작업이 온프레미스에서 먼저 되어 있었기 때문에, AWW EKS에서도 `registry-credentials` Secret만 생성하면 바로 이미지를 pull할 수 있었다. 만약 이 선행 작업 없이 AWW 배포를 시작했다면, "레지스트리 인증이 안 된다"는 문제까지 겹쳐서 훨씬 복잡했을 것이다.

## 최종 배포 파이프라인

모든 트러블슈팅을 거친 후, AWW 배포 시 데이터가 흐르는 최종 경로:

```mermaid
flowchart LR
    Dev["개발자<br/>코드 push"]
    GL["온프레미스 GitLab"]
    JK["Jenkins"]
    NX["AWS Nexus"]
    AGL["AWS GitLab"]
    Argo["EKS ArgoCD"]
    K8s["EKS Pods"]

    Dev -->|"git push<br/>(aww 브랜치)"| GL
    GL -->|"webhook"| JK
    JK -->|"docker build<br/>+ push"| NX
    GL -->|"git mirror"| AGL
    Argo -->|"git poll"| AGL
    Argo -->|"helm template<br/>+ deploy"| K8s
    K8s -->|"image pull"| NX
```

1. 개발자가 `aww` 브랜치에 코드를 push한다
2. Jenkins가 `SITE=aww`로 트리거되어 이미지를 빌드하고, `siteRegistries.aww.host`로 push한다
3. xgen-infra가 AWS GitLab에 미러링된다
4. EKS의 ArgoCD가 AWS GitLab을 polling하다가 변경을 감지한다
5. `projects/xgen-aww.yaml` 설정에 따라 6개 서비스를 배포한다
6. Pod가 `registryHost`에 지정된 AWS Nexus에서 이미지를 pull한다

## 정리

### 결국 통했나

통했다. 하지만 "yaml 하나면 끝"은 절반만 맞았다.

`projects/*.yaml` 단일 진입점 구조 자체는 유효했다. AWW의 모든 배포 설정 — 6개 서비스의 리소스, 환경변수, 인프라 주소, 레지스트리 — 이 `xgen-aww.yaml` 한 파일에 들어있다. 구조가 없었으면 서비스마다 yaml을 따로 만들어야 했을 것이다.

문제는 **구조 안의 빈칸**이었다. 레지스트리 호스트 오버라이드(`registryHost`), 사이트별 빌드 레지스트리(`siteRegistries`), MinIO 하드코딩 제거 — 이것들은 아키텍처 설계 시점에 예상하지 못한 변수다. 온프레미스끼리만 배포하면 드러나지 않는, 환경이 바뀌어야만 보이는 구멍이었다.

### 수정한 파일 목록

AWW 고객사를 추가하면서 실제로 수정한 파일:

| 파일 | 변경 내용 |
|------|----------|
| `projects/xgen-aww.yaml` | 신규 생성 — AWW 전체 설정 |
| `project.yaml` | `siteRegistries.aww` 추가 |
| `build.groovy` | siteRegistries 분기 로직 |
| `build-all.groovy` | SITE choices에 aww 추가 |
| `application.yaml` (ArgoCD 템플릿) | `registryHost` 파라미터 추가 |
| `ingress.yaml` (Helm 템플릿) | 빈 도메인 시 Gateway 생성 방지 |
| `config.yml` (backend-gateway) | `xgen-aww` 섹션 추가, URL 따옴표 처리 |

처음 기대한 "파일 1~2개 수정"보다는 많지만, 6개 마이크로서비스 전체를 새 환경에 배포한 것 치고는 적다. 그리고 `application.yaml`과 `ingress.yaml`의 수정은 AWW 전용이 아니라 **모든 고객사에 적용되는 구조 개선**이다. 다음 고객사부터는 이 문제가 반복되지 않는다.

### 배운 것

**하드코딩은 환경이 바뀌는 순간 터진다.** MinIO의 `minio / minio123`은 온프레미스에서 문제 없이 1년 넘게 돌았다. 하지만 S3로 전환하는 순간 장애 요인이 됐다. "지금 동작하니까 괜찮다"는 생각으로 남겨둔 하드코딩은, 결국 가장 바쁜 배포 시점에 발목을 잡는다.

**온프레미스 → 클라우드는 레지스트리부터 다르다.** 같은 Nexus를 공유하는 온프레미스 고객사끼리는 `site` 값만 바꾸면 됐다. 클라우드 고객사는 레지스트리 호스트 자체가 다르고, 인증 방식도 다르다. 멀티 고객사 아키텍처를 설계할 때, "모든 고객사가 같은 레지스트리를 쓴다"는 전제를 두지 않는 게 맞다.

**YAML 특수문자는 따옴표로 감싸라.** `!`가 YAML 태그로 해석되어 설정 전체가 무너지는 문제는 에러 로그도 없이 silent failure로 나타났다. 비밀번호, URL 등 외부에서 오는 값은 무조건 따옴표로 감싸는 습관이 필요하다. 특히 Rust serde_yaml처럼 YAML 1.1 스펙을 엄격하게 따르는 파서를 사용할 때.

**환경별 비밀번호를 가정하지 마라.** "같은 플랫폼이니까 비밀번호도 같겠지"라는 가정으로 30분을 날렸다. Secret은 Git에 없으니 배포 체크리스트에 "인프라 인증 정보 확인" 항목이 반드시 필요하다.

**선행 작업의 가치.** Nexus 인증(`imagePullSecrets`)을 온프레미스에서 먼저 해결해둔 덕분에 AWW EKS에서 이미지 pull 문제가 생기지 않았다. 인프라 기반 작업은 "지금 당장 필요하지 않더라도" 미리 해두면 나중에 시간을 절약해준다.
