---
title: 롯데홈쇼핑 폐쇄망 서버 SSH 터널링과 접속 구성
description: 방화벽으로 막힌 폐쇄망 환경에서 SSH 포트 포워딩으로 ArgoCD, Jenkins, MinIO에 접근하고 배포하는 실전 가이드
pubDatetime: 2026-02-04
tags:
- SSH
- 터널링
- 폐쇄망
- DevOps
- K3s
- 롯데홈쇼핑
- 포트 포워딩
- 방화벽
---


## 배경

XGEN 2.0을 롯데홈쇼핑에 납품하면서 폐쇄망 환경에 K3s 클러스터를 구축했다. 롯데 내부 네트워크는 외부에서 직접 접근이 불가능하고, 개발팀이 서버에 접근하려면 VDI(가상 데스크탑)를 통해야 한다.

문제는 VDI에서도 서버의 K8s 관리 포트, ArgoCD Web UI, Jenkins, MinIO 같은 서비스에 직접 웹 브라우저로 접근할 수 없다는 점이었다. 방화벽 정책이 특정 포트만 허용하고, 내부 서비스들은 K3s NodePort로 노출되어 있어서 포트 번호도 비표준이다.

SSH 포트 포워딩으로 이 문제를 해결했다.

## 인프라 구성

롯데 측에서 할당받은 서버 구성이다.

```
서버 역할:
prdaixgenapp01  10.144.158.11  — K3s Master + Worker (주 서버)
prdaixgenapp02  10.144.158.12  — K3s Worker (보조 서버)
prdaixgendb01   10.144.145.51  — PostgreSQL, Redis, MinIO (인프라 전용)

접속 계정:
- 일반 작업: plateeruser
- 관리 작업: plateermgmt
```

두 개의 계정으로 권한을 분리했다. `plateeruser`는 docker/kubectl 명령 실행 권한, `plateermgmt`는 sudo 포함 시스템 관리 권한이다.

## SSH 터널링 기본 원리

SSH 포트 포워딩은 로컬 포트를 원격 서버를 통해 목적지로 연결한다.

```bash
ssh -N -L [로컬포트]:[목적지호스트]:[목적지포트] [SSH서버]
```

- `-N`: 원격 명령 실행 없이 포워딩만 수행
- `-L`: 로컬 포트 포워딩 (내 컴퓨터 → SSH 서버 → 목적지)

예를 들어 ArgoCD NodePort(31200)에 접근하려면:

```bash
ssh -N -L 8080:localhost:31200 plateermgmt@10.144.158.11
```

이후 내 브라우저에서 `http://localhost:8080`으로 접속하면 롯데 서버의 ArgoCD Web UI가 보인다.

## 서비스별 터널링 명령

### ArgoCD

```bash
# ArgoCD Web UI (K3s NodePort 31200)
ssh -N -L 8080:localhost:31200 plateermgmt@10.144.158.11
# 접속: http://localhost:8080
# 계정: admin / (초기 비밀번호: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)
```

### Jenkins

```bash
# Jenkins Web UI (K3s NodePort 30888)
ssh -N -L 8888:localhost:30888 plateermgmt@10.144.158.11
# 접속: http://localhost:8888
```

### MinIO

```bash
# MinIO Web Console (Docker Compose 9001)
ssh -N -L 9001:localhost:9001 plateermgmt@10.144.145.51
# 접속: http://localhost:9001

# MinIO API (Docker Compose 9000)
ssh -N -L 9000:localhost:9000 plateermgmt@10.144.145.51
```

MinIO는 인프라 전용 서버(prdaixgendb01)에 있으므로 app01이 아닌 db01 서버에 연결한다.

### Grafana / Prometheus

```bash
# Grafana (K3s NodePort 30030)
ssh -N -L 3000:localhost:30030 plateermgmt@10.144.158.11
# 접속: http://localhost:3000

# Prometheus (K3s NodePort 30091)
ssh -N -L 9091:localhost:30091 plateermgmt@10.144.158.11
# 접속: http://localhost:9091
```

## 멀티 터널 스크립트

매번 여러 터널을 하나씩 열기 귀찮아서 한 번에 여는 스크립트를 만들었다.

```bash
#!/bin/bash
# connect-lotte.sh

SERVER_APP="plateermgmt@10.144.158.11"
SERVER_DB="plateermgmt@10.144.145.51"

echo "롯데 서버 터널링 시작..."

# app 서버 터널 (백그라운드)
ssh -N -f \
    -L 8080:localhost:31200 \   # ArgoCD
    -L 8888:localhost:30888 \   # Jenkins
    -L 3000:localhost:30030 \   # Grafana
    -L 9091:localhost:30091 \   # Prometheus
    ${SERVER_APP}

# db 서버 터널 (백그라운드)
ssh -N -f \
    -L 9001:localhost:9001 \    # MinIO Console
    -L 9000:localhost:9000 \    # MinIO API
    ${SERVER_DB}

echo "터널 활성화 완료"
echo "  ArgoCD:     http://localhost:8080"
echo "  Jenkins:    http://localhost:8888"
echo "  Grafana:    http://localhost:3000"
echo "  Prometheus: http://localhost:9091"
echo "  MinIO:      http://localhost:9001"
echo ""
echo "종료: kill \$(lsof -ti:8080,8888,3000,9091,9001,9000)"
```

`-f` 옵션으로 백그라운드에서 실행되므로 터미널을 닫아도 터널이 유지된다.

종료할 때는:
```bash
kill $(lsof -ti:8080,8888,3000,9091,9001,9000)
```

## kubectl 원격 접근

로컬 kubectl로 롯데 K3s 클러스터를 직접 제어할 수도 있다. K3s는 기본적으로 6443 포트로 API 서버가 열려있다.

```bash
# K3s API 서버 포워딩
ssh -N -L 6443:localhost:6443 plateermgmt@10.144.158.11

# 롯데 서버에서 kubeconfig 가져오기
scp plateermgmt@10.144.158.11:/etc/rancher/k3s/k3s.yaml ~/.kube/lotte-config

# server 주소를 localhost로 변경
sed -i 's/https:\/\/127.0.0.1:6443/https:\/\/localhost:6443/' ~/.kube/lotte-config

# 컨텍스트 전환
export KUBECONFIG=~/.kube/lotte-config
kubectl get nodes
```

터널이 열린 상태에서 `kubectl get nodes`를 실행하면 롯데 서버의 K3s 노드 목록이 나온다.

## 폐쇄망 이미지 배포 전략

폐쇄망에서 가장 큰 문제는 Docker 이미지를 어떻게 넣느냐다. DockerHub나 GitLab Registry에 직접 접근이 안 된다.

두 가지 방법을 사용했다.

### 방법 1: 이미지 export/import

```bash
# 개발 서버에서 이미지를 tar로 저장
docker save registry.x2bee.com/xgen-core:latest | gzip > xgen-core-latest.tar.gz

# 롯데 서버로 scp 전송
scp xgen-core-latest.tar.gz plateermgmt@10.144.158.11:/tmp/

# 롯데 서버에서 이미지 load
ssh plateermgmt@10.144.158.11 "
    docker load < /tmp/xgen-core-latest.tar.gz
    docker tag registry.x2bee.com/xgen-core:latest docker.x2bee.com/xgen-core:latest
    docker push docker.x2bee.com/xgen-core:latest
"
```

`docker.x2bee.com`은 롯데 서버에 설치한 로컬 Nexus Registry다.

### 방법 2: 내부 Nexus Registry 구성

롯데 서버에 Nexus를 설치하고 Docker Proxy Repository를 구성했다.

```bash
# Nexus가 DockerHub를 프록시하도록 설정
# (Nexus Web UI에서 Docker proxy repository 생성)
# proxy URL: https://registry-1.docker.io

# K3s 노드가 Nexus를 통해 이미지를 pull
# /etc/rancher/k3s/registries.yaml
mirrors:
  docker.io:
    endpoint:
      - "http://docker.x2bee.com:5000"
  registry.x2bee.com:
    endpoint:
      - "http://docker.x2bee.com:5000"
```

폐쇄망에서 Nexus가 한 번 이미지를 캐시하면 이후 pull은 Nexus 내부에서 처리된다.

## SSH 설정 최적화

터널링을 자주 쓰다 보면 `~/.ssh/config`에 설정을 추가하는 게 편하다.

```
# ~/.ssh/config
Host lotte-app
    HostName 10.144.158.11
    User plateermgmt
    IdentityFile ~/.ssh/lotte_rsa
    ServerAliveInterval 60
    ServerAliveCountMax 10
    LocalForward 8080 localhost:31200
    LocalForward 8888 localhost:30888
    LocalForward 3000 localhost:30030

Host lotte-db
    HostName 10.144.145.51
    User plateermgmt
    IdentityFile ~/.ssh/lotte_rsa
    ServerAliveInterval 60
    LocalForward 9001 localhost:9001
```

이렇게 설정하면 `ssh lotte-app`만 실행해도 ArgoCD, Jenkins, Grafana 터널이 자동으로 열린다.

`ServerAliveInterval 60`과 `ServerAliveCountMax 10`은 연결이 끊기는 것을 방지한다. VPN이나 폐쇄망 환경에서는 idle 연결이 자주 끊기므로 keepalive 설정이 필수다.

## 롯데 배포 운영 경험

폐쇄망 K3s 운영에서 특이한 점이 있었다.

**cert-manager 인증서 발급 불가**: 폐쇄망이라 Let's Encrypt ACME 챌린지가 불가능하다. HTTP01 챌린지는 외부 서버가 도메인의 HTTP 포트에 접근해야 하는데, 폐쇄망에서는 외부 접근이 막혀있다. 결국 TLS를 비활성화하고 내부 네트워크 HTTP로만 운영했다.

**이미지 업데이트**: 신규 버전 배포 시 이미지를 먼저 롯데 서버로 전송한 후 ArgoCD sync를 실행했다. Jenkins 파이프라인이 이미지를 Nexus에 push하고, ArgoCD가 새 이미지 태그를 감지해서 배포하는 방식이었다.

**DNS 설정**: 롯데 서버에 Technitium DNS를 설치해서 내부 도메인(jeju-xgen.x2bee.com)을 K3s NodePort IP로 해석하도록 설정했다. 사용자들은 VDI에서 브라우저로 도메인을 입력하면 K3s로 라우팅됐다.

## 결과

- SSH 터널링으로 폐쇄망 서버의 모든 관리 UI에 접근 가능
- 멀티 터널 스크립트로 한 번에 전체 환경 접속
- Nexus Registry로 폐쇄망 이미지 배포 자동화
- `~/.ssh/config` 설정으로 터널링 명령 단순화

폐쇄망 환경은 개발 편의성이 낮아서 처음에는 불편하지만, SSH 터널링 + 스크립트 자동화로 대부분의 불편함을 해소할 수 있다.
