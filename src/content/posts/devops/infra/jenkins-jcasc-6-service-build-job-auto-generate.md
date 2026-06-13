---
title: Jenkins JCasC로 6개 서비스 빌드 Job 자동 생성하기
description: Configuration as Code와 seed job Groovy DSL로 Jenkins 파이프라인 수동 클릭 없이 자동
  생성하는 과정
pubDatetime: 2026-01-20
tags:
- Jenkins
- JCasC
- DevOps
- CI/CD
- Groovy
- K3s
- 자동화
- 파이프라인
---


## 배경

XGEN 2.0 인프라를 K3s로 전환하면서 Jenkins도 Helm으로 새로 설치했다. 문제는 Jenkins의 숙명적인 단점 — UI에서 일일이 Job을 클릭해서 만들어야 한다는 것이다. 서비스가 6개(xgen-model, xgen-core, xgen-workflow, xgen-frontend, xgen-documents, xgen-backend-gateway)라면 각 서비스마다 dev/prod 환경별 Job을 만들어야 하고, 빌드 스텝, 파라미터, SSH 설정, ArgoCD 연동까지 매번 손으로 입력해야 한다.

이걸 코드로 관리하지 않으면 Jenkins가 재시작될 때마다 설정이 날아간다. JCasC(Jenkins Configuration as Code)와 seed job을 조합해서 이 문제를 완전히 해결했다.

## JCasC란

Jenkins Configuration as Code는 Jenkins 자체의 시스템 설정(Global Security, Credentials, Tools, Executors 등)을 YAML 파일로 관리하는 플러그인이다. Helm 차트의 `values.yaml`에 `controller.JCasC` 섹션을 정의하면 Jenkins 기동 시점에 자동으로 설정이 적용된다.

JCasC가 담당하는 것:
- Jenkins URL, 관리자 계정
- Kubernetes agent template (빌드 실행 Pod 스펙)
- Credentials (Docker Hub, GitLab SSH, ArgoCD 토큰)
- Security realm, Authorization Strategy
- Executor 수

Seed job이 담당하는 것:
- 실제 파이프라인 Job 생성 (DSL로 코드화)
- 서비스별 파라미터, 빌드 스텝, 환경변수

이 두 가지를 조합해야 Jenkins를 완전히 코드로 관리할 수 있다.

## Helm values 구조

```yaml
# values-override.yaml
controller:
  numExecutors: 6

  JCasC:
    configScripts:
      casc-config: |
        jenkins:
          numExecutors: 6
          systemMessage: "XGEN 2.0 Jenkins"

        credentials:
          system:
            domainCredentials:
              - credentials:
                  - usernamePassword:
                      scope: GLOBAL
                      id: "gitlab-credentials"
                      username: "jenkins"
                      password: "${GITLAB_TOKEN}"
                  - string:
                      scope: GLOBAL
                      id: "argocd-token"
                      secret: "${ARGOCD_TOKEN}"
```

`${GITLAB_TOKEN}` 같은 환경변수는 Jenkins Pod의 Secret으로 주입된다. Helm 배포 시 `--set controller.adminPassword=...` 형태로 넣거나 K8s Secret을 참조한다.

## seed-jobs.groovy

핵심은 `seed-jobs.groovy` 파일이다. 이 Groovy 스크립트가 실행되면 6개 서비스의 Jenkins Job이 자동으로 생성된다.

```groovy
// seed-jobs.groovy
def services = [
    [name: "xgen-model",            repo: "xgen2.0/xgen-model",            port: 8001],
    [name: "xgen-core",             repo: "xgen2.0/xgen-core",             port: 8002],
    [name: "xgen-workflow",         repo: "xgen2.0/xgen-workflow",         port: 8003],
    [name: "xgen-frontend",         repo: "xgen2.0/xgen-frontend",         port: 3000],
    [name: "xgen-documents",        repo: "xgen2.0/xgen-documents",        port: 8004],
    [name: "xgen-backend-gateway",  repo: "xgen2.0/xgen-backend-gateway",  port: 8080],
]

def environments = ["dev", "prod"]

services.each { svc ->
    environments.each { env ->
        def jobName = "${svc.name}-${env}"

        pipelineJob(jobName) {
            description("${svc.name} ${env} 환경 빌드 & 배포")

            parameters {
                stringParam("BRANCH", env == "prod" ? "main" : "develop", "배포할 브랜치")
                stringParam("IMAGE_TAG", "", "Docker 이미지 태그 (비워두면 commit SHA 사용)")
                booleanParam("NO_CACHE", false, "Docker 빌드 캐시 무시")
                choiceParam("TARGET_ENV", [env, "dev", "prod"], "배포 대상 환경")
            }

            definition {
                cpsScm {
                    scm {
                        git {
                            remote {
                                url("git@gitlab.x2bee.com:${svc.repo}.git")
                                credentials("gitlab-ssh-key")
                            }
                            branch('${BRANCH}')
                        }
                    }
                    scriptPath("Jenkinsfile")
                }
            }
        }
    }
}
```

이 스크립트 하나로 `xgen-model-dev`, `xgen-model-prod`, `xgen-core-dev` ... 총 12개 Job이 생성된다.

## Jenkinsfile 공통 템플릿

각 서비스의 저장소에는 `Jenkinsfile`이 있다. 공통 패턴은 다음과 같다.

```groovy
pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: docker
    image: docker:24-dind
    securityContext:
      privileged: true
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
"""
        }
    }

    parameters {
        string(name: 'BRANCH', defaultValue: 'develop')
        string(name: 'IMAGE_TAG', defaultValue: '')
        booleanParam(name: 'NO_CACHE', defaultValue: false)
        choice(name: 'TARGET_ENV', choices: ['dev', 'prod'])
    }

    environment {
        REGISTRY = "registry.x2bee.com"
        SERVICE_NAME = "xgen-model"
        IMAGE_TAG = "${params.IMAGE_TAG ?: env.GIT_COMMIT[0..7]}"
    }

    stages {
        stage('Build') {
            steps {
                container('docker') {
                    script {
                        def buildArgs = params.NO_CACHE ? "--no-cache" : ""
                        sh """
                            docker build ${buildArgs} \
                                -t ${REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG} \
                                -f Dockerfile .
                        """
                    }
                }
            }
        }

        stage('Push') {
            steps {
                container('docker') {
                    withCredentials([usernamePassword(
                        credentialsId: 'registry-credentials',
                        usernameVariable: 'REGISTRY_USER',
                        passwordVariable: 'REGISTRY_PASS'
                    )]) {
                        sh """
                            docker login -u ${REGISTRY_USER} -p ${REGISTRY_PASS} ${REGISTRY}
                            docker push ${REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG}
                        """
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                script {
                    withCredentials([string(credentialsId: 'argocd-token', variable: 'ARGOCD_TOKEN')]) {
                        sh """
                            argocd app set ${SERVICE_NAME}-${TARGET_ENV} \
                                --helm-set image.tag=${IMAGE_TAG} \
                                --auth-token ${ARGOCD_TOKEN}
                            argocd app sync ${SERVICE_NAME}-${TARGET_ENV} \
                                --auth-token ${ARGOCD_TOKEN}
                        """
                    }
                }
            }
        }
    }
}
```

`TARGET_ENV` 파라미터로 dev/prod 중 어느 ArgoCD 앱에 배포할지 제어한다.

## seed job 등록 과정의 삽질

### executor 수 문제

처음에는 `numExecutors: 2`로 설정했다. 6개 서비스를 동시 빌드하다 보면 빌드 큐가 쌓이고 대기 시간이 길어진다. 특히 Docker build가 오래 걸리는 서비스(xgen-model은 PyTorch 이미지라 10분 이상)가 executor를 점유하면 나머지 서비스가 줄줄이 대기한다.

```yaml
# # 커밋: Jenkins executor 수를 2에서 6으로 증가 (6개 서비스 동시 빌드)
# # 날짜: 2024-09-10
controller:
  numExecutors: 6
```

executor를 6으로 늘리니 모든 서비스가 동시에 빌드 가능해졌다. 물론 빌드 노드(K3s 워커)의 CPU/메모리가 충분해야 한다.

### seed job 폴더 구조

처음엔 Job 이름을 flat하게 `xgen-model-dev`로 만들었다. Job이 12개가 되니 Jenkins 대시보드가 지저분해졌다. folder를 활용해 서비스별로 그룹화했다.

```groovy
// # 커밋: Jenkins seed-jobs에 서비스별 folder 구조 추가
// # 날짜: 2024-08-22
services.each { svc ->
    folder(svc.name) {
        description("${svc.name} 빌드 Job 모음")
    }

    environments.each { env ->
        pipelineJob("${svc.name}/${env}") {
            // ...
        }
    }
}
```

이렇게 하면 `xgen-model/dev`, `xgen-model/prod` 형태로 계층 구조가 생겨 관리가 훨씬 편해진다.

### executor iteration 오류

seed job에서 `services.each`를 쓸 때 Groovy의 클로저 스코프 문제로 `svc` 변수가 마지막 요소로 고정되는 현상이 있었다. CPS(Continuation Passing Style) 변환 이슈다.

```groovy
// # 커밋: seed-job executor iteration 변수 스코프 fix
// # 날짜: 2024-08-25

// 문제 있는 코드
services.each { svc ->
    pipelineJob("${svc.name}-dev") {
        // 모든 Job이 마지막 svc(xgen-backend-gateway)를 참조함
    }
}

// 수정 코드
for (def svc in services) {
    def serviceName = svc.name
    def serviceRepo = svc.repo

    pipelineJob("${serviceName}-dev") {
        // serviceName은 각 iteration에서 올바른 값을 유지
    }
}
```

`def`로 각 iteration에서 새 변수를 선언해야 클로저 캡처가 올바르게 동작한다.

## ArgoCD 연동

Jenkins가 빌드/푸시를 마치면 ArgoCD로 배포 트리거를 보낸다. ArgoCD는 Git 저장소의 Helm values를 기반으로 동작하므로, Jenkins에서는 두 가지 방식 중 하나를 쓴다.

**방식 1: image.tag 직접 설정**
```bash
argocd app set xgen-model-dev --helm-set image.tag=abc1234
argocd app sync xgen-model-dev
```

**방식 2: Git values 파일 업데이트 후 auto-sync 대기**
```bash
# values-dev.yaml에 image.tag 업데이트 후 커밋
git commit -m "ci: xgen-model image tag abc1234"
git push origin main
# ArgoCD auto-sync가 Git 변경 감지해서 자동 배포
```

XGEN 2.0에서는 방식 1을 채택했다. Git 커밋 없이 즉각 배포가 가능하고, Jenkins 빌드 번호와 이미지 태그를 1:1 매핑할 수 있어서다.

## 결과

- Jenkins 재설치 후 seed job 한 번 실행으로 12개 Job 자동 복구
- UI 클릭 없이 모든 Job 설정 코드로 버전관리
- 새 서비스 추가 시 `services` 리스트에 항목 하나 추가로 끝
- `TARGET_ENV` 파라미터로 dev/prod 임의 배포 가능

JCasC + seed job 조합은 Jenkins를 GitOps 방식으로 운영하는 표준 패턴이다. 처음 설정이 조금 복잡하지만 한 번 해놓으면 Jenkins 재설치가 두렵지 않다.

---

**관련 글**

- [XGEN K3s 인프라 완전 해부 (4) — CI/CD 파이프라인](xgen-k3s-anatomy-4-cicd-jenkins-argocd.md): Jenkins 빌드 파이프라인과 ArgoCD GitOps 배포의 전체 아키텍처
- [Jenkins RBAC Kubernetes 권한 설정 삽질기](jenkins-rbac-kubernetes-permission-config-troubleshoot.md): Jenkins에서 K8s 리소스에 접근할 때 필요한 RBAC 권한 설정과 트러블슈팅
