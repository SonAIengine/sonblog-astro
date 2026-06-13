---
title: 'Jenkins executor 수 최적화: 6개 서비스 동시 빌드를 위한 성능 튜닝'
description: numExecutors 2에서 6으로 증가, K3s 노드 리소스 계획, 빌드 큐 병목 해소 과정
pubDatetime: 2026-01-20
tags:
- Jenkins
- DevOps
- CI/CD
- 성능최적화
- K3s
- 동시 빌드
- 파이프라인
---


## 배경

XGEN 2.0 서비스는 6개다: xgen-model, xgen-core, xgen-workflow, xgen-frontend, xgen-documents, xgen-backend-gateway. 각 서비스는 Jenkins Job을 통해 빌드되고 ArgoCD로 배포된다.

배포 시 6개 서비스를 동시에 업데이트하는 경우가 있다. 전체 인프라 변경이나 주요 버전 업그레이드 때다. 이때 Jenkins executor가 2개뿐이면 빌드 큐가 4개씩 쌓이고, 빌드 완료까지 30~40분이 걸렸다.

## 문제: executor 2개의 한계

```
[빌드 큐 상황 (executor 2개)]

실행 중: xgen-model (10분), xgen-frontend (5분)
대기:   xgen-core, xgen-workflow, xgen-documents, xgen-backend-gateway

xgen-model 완료 → xgen-core 시작
xgen-frontend 완료 → xgen-workflow 시작
... 총 소요 시간: 35분 (직렬 처리)
```

특히 `xgen-model`은 PyTorch 이미지를 포함해 Docker 빌드에 10~15분이 걸린다. 이 Job이 executor를 점유하는 동안 나머지 서비스들이 줄줄이 대기한다.

## numExecutors 설정

```yaml
# values-override.yaml
# # 커밋: Jenkins numExecutors 2 → 6으로 증가 (6개 서비스 동시 빌드 지원)
# # 날짜: 2024-09-10
controller:
  numExecutors: 6
```

JCasC 설정도 함께 업데이트했다.

```yaml
# casc-config.yaml
# # 커밋: JCasC numExecutors 6으로 업데이트 (값 일관성 유지)
# # 날짜: 2024-09-10
jenkins:
  numExecutors: 6
  systemMessage: "XGEN 2.0 Jenkins"
```

두 곳을 모두 업데이트해야 한다. `values.yaml`의 `numExecutors`는 초기 설치 시에만 적용되고, JCasC의 값이 Jenkins 재시작 후 덮어쓰기 때문이다. 값이 다르면 어떤 것이 우선인지 헷갈린다.

## 리소스 계획

executor 수를 늘리기 전에 K3s 노드의 리소스를 확인해야 한다. 빌드 Pod는 Docker DinD(Docker in Docker)를 사용하므로 CPU/메모리를 꽤 쓴다.

```yaml
# Jenkins Kubernetes agent Pod 리소스 설정
clouds:
  - kubernetes:
      templates:
        - name: "default"
          containers:
            - name: "docker"
              image: "docker:24-dind"
              resourceRequestCpu: "500m"
              resourceLimitCpu: "2"
              resourceRequestMemory: "512Mi"
              resourceLimitMemory: "4Gi"
```

executor 1개 = 빌드 Pod 1개 = 최대 2 CPU, 4GB RAM.

executor 6개 동시 실행 = 최대 12 CPU, 24GB RAM.

서버 스펙(32 CPU, 128GB RAM)에서는 충분히 수용 가능하다. 하지만 xgen-model 빌드는 PyTorch 이미지 레이어가 크고 I/O가 많아서, 실제로는 6개 동시 빌드 시 디스크 I/O가 병목이 됐다.

## 서비스별 빌드 시간 분류

6개 서비스의 빌드 시간이 제각각이다. 이를 파악하고 빌드 순서를 고려해야 한다.

| 서비스 | 평균 빌드 시간 | 이유 |
|--------|--------------|------|
| xgen-model | 12~15분 | PyTorch, CUDA 관련 패키지 |
| xgen-core | 4~6분 | FastAPI, SQLAlchemy |
| xgen-workflow | 4~5분 | 유사한 의존성 |
| xgen-frontend | 8~10분 | Next.js 빌드, node_modules |
| xgen-documents | 6~8분 | 임베딩 모델 의존성 |
| xgen-backend-gateway | 3~5분 | Rust 빌드 (캐시 있을 때) |

executor 6개로 모두 동시 시작하면 이론적으로 가장 오래 걸리는 xgen-model의 빌드 시간인 15분에 수렴한다. 실제로는 디스크 I/O 경합으로 20분 전후로 완료됐지만, 기존 35분에서 크게 개선됐다.

## 빌드 큐 모니터링

Jenkins에서 executor 사용량을 확인하는 방법이다.

```bash
# Jenkins CLI로 executor 상태 확인
java -jar jenkins-cli.jar -s http://jenkins.x2bee.com/ \
    -auth admin:${JENKINS_TOKEN} \
    list-jobs

# Jenkins API로 큐 상태 확인
curl -u admin:${JENKINS_TOKEN} \
    http://jenkins.x2bee.com/queue/api/json?pretty=true

# 실행 중인 빌드 확인
curl -u admin:${JENKINS_TOKEN} \
    "http://jenkins.x2bee.com/api/json?tree=jobs[name,builds[number,building,duration]]&pretty=true"
```

## Kubernetes 빌드 에이전트 주의사항

Jenkins가 K8s에서 실행될 때 빌드 Pod가 동적으로 생성/삭제된다. executor 수가 빌드 Pod 생성 한계를 결정하는 것이 아니라, K8s 클러스터의 가용 리소스가 실제 한계다.

```yaml
# jenkins-kubernetes-cloud.yaml
kubernetes:
  maxRequestsPerHost: 64
  containerCapStr: "10"  # 최대 동시 빌드 Pod 수
```

`containerCapStr`은 Kubernetes 에이전트의 전체 Pod 수 제한이다. executor 6개에 맞게 최소 6 이상으로 설정해야 한다.

## 빌드 병렬화 전략

단순히 executor 수를 늘리는 것 외에, 파이프라인 내부에서도 병렬화를 적용할 수 있다.

```groovy
// 멀티 서비스를 하나의 파이프라인에서 병렬 빌드
pipeline {
    stages {
        stage('Build All Services') {
            parallel {
                stage('xgen-model') {
                    steps { build job: 'xgen-model/dev' }
                }
                stage('xgen-core') {
                    steps { build job: 'xgen-core/dev' }
                }
                stage('xgen-workflow') {
                    steps { build job: 'xgen-workflow/dev' }
                }
                stage('xgen-frontend') {
                    steps { build job: 'xgen-frontend/dev' }
                }
                stage('xgen-documents') {
                    steps { build job: 'xgen-documents/dev' }
                }
                stage('xgen-backend-gateway') {
                    steps { build job: 'xgen-backend-gateway/dev' }
                }
            }
        }
    }
}
```

`parallel` 블록을 사용하면 여러 Job을 하나의 파이프라인에서 동시에 트리거할 수 있다. 각 Job이 별도 executor를 사용하므로 executor 6개가 모두 활용된다.

## 디스크 I/O 병목 대응

6개 동시 빌드 시 Docker 이미지 레이어 pull/push가 동시에 발생해 디스크 I/O가 포화 상태가 됐다. 특히 레지스트리 push 단계에서 네트워크 + 디스크가 동시에 한계에 달했다.

**해결책 1: 빌드 순서 조정**
```groovy
// xgen-model을 먼저 트리거 (빌드 시간이 가장 김)
// 나머지는 xgen-model 시작 후 1~2분 지연해서 트리거
stage('Staggered Build') {
    steps {
        build job: 'xgen-model/dev', wait: false
        sleep(time: 2, unit: 'MINUTES')
        parallel {
            stage('core') { steps { build job: 'xgen-core/dev' } }
            stage('workflow') { steps { build job: 'xgen-workflow/dev' } }
            // ...
        }
    }
}
```

**해결책 2: 로컬 레지스트리 캐시 활용**

Harbor 레지스트리에 캐시 설정을 추가해 같은 베이스 이미지 레이어를 반복 다운로드하지 않도록 했다.

## 결과

- executor 2 → 6으로 증가
- 전체 6개 서비스 동시 배포 시간: 35분 → 20분
- JCasC와 values.yaml 양쪽 값 일관성 유지 필요
- K8s 동적 에이전트 덕분에 idle 시 리소스 낭비 없음

Jenkins executor 수는 "서비스 개수에 맞춰라"가 직관적인 기준이다. executor 수보다 실제 빌드 리소스(CPU, 메모리, 디스크 I/O)가 진짜 병목인 경우가 많으니, 리소스 모니터링과 함께 튜닝해야 한다.
