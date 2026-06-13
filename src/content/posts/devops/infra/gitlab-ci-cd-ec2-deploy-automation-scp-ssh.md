---
title: 'GitLab CI/CD에서 EC2 배포 자동화: SCP + SSH 파이프라인 구축'
description: synonym.txt 파일을 GitLab에서 EC2 OpenSearch 서버로 자동 배포하는 CI/CD 파이프라인 구축 과정.
  12번의 삽질 끝에 완성한 .gitlab-ci.yml 실전 가이드
pubDatetime: 2025-04-10
tags:
- GitLab CI/CD
- EC2
- SSH
- SCP
- DevOps
- 자동화
---


## 배경

Rust 검색 엔진 프로젝트에서 OpenSearch 동의어 사전(synonym.txt)을 관리했다. 동의어 파일은 GitLab 레포지토리에서 관리하고, EC2에서 실행 중인 OpenSearch 컨테이너가 이 파일을 읽는 구조였다.

문제는 파일을 업데이트할 때마다 EC2에 직접 SSH 접속해서 파일을 복사하는 작업이 반복됐다는 점이다. 팀원이 동의어를 추가하거나 수정할 때마다 개발자가 중간에서 수동으로 배포를 해야 했다.

GitLab CI/CD로 이 과정을 자동화하기로 했다. `main` 브랜치에 `run`으로 시작하는 커밋 메시지가 올라오면 자동으로 EC2에 파일을 배포하는 파이프라인이다.

이 작업이 단순해 보였는데 `.gitlab-ci.yml`을 12번 연속으로 수정하고 나서야 완성됐다.

## 파이프라인 설계

최종적으로 구성한 파이프라인은 4단계다.

```mermaid
graph LR
    A[check-vars] --> B[mkdir-target-dir]
    B --> C[scp-transfer]
    C --> D[confirm-files]
```

- **check-vars**: 환경변수(EC2 호스트, 대상 경로) 출력 확인
- **mkdir-target-dir**: EC2에 SSH로 접속해 대상 디렉토리 생성
- **scp-transfer**: 레포에서 파일을 clone해서 EC2로 SCP 전송
- **confirm-files**: EC2에서 `ls`로 파일이 제대로 전송됐는지 확인

## 12번의 삽질 타임라인

```
# 2025-04-09 — 하루 종일 ci 수정
b39a77ed  Update .gitlab-ci.yml file
c4f21a88  Update .gitlab-ci.yml file
a19f3b11  Update .gitlab-ci.yml file
d7e52c90  Update .gitlab-ci.yml file
...
(총 12회 연속 수정)

# 2025-04-10 — 최종 완성
7e774b66  Enhance GitLab CI/CD configuration
03efe0a7  Refactor .gitlab-ci.yml
ab75abce  Update .gitlab-ci.yml to change EC2 target directory
```

커밋 메시지가 전부 "Update .gitlab-ci.yml file"이다. 당시 상황을 짐작할 수 있다.

### 삽질 1: runner 태그

처음에 GitLab runner 태그를 `runners-runners-project`로 설정했다. 이 태그는 Docker executor 러너였는데, SSH 키를 직접 다루는 작업에 Docker executor는 맞지 않았다. Shell executor 러너인 `gitlab-runner-shell`로 변경해야 했다.

```yaml
# 변경 전 (Docker executor — 안됨)
tags:
  - runners-runners-project

# 변경 후 (Shell executor — 작동)
tags:
  - gitlab-runner-shell
```

Shell executor는 러너가 설치된 서버에서 직접 명령을 실행한다. SSH 키 파일을 `~/.ssh/`에 만들고 `chmod`를 적용하는 작업이 정상적으로 동작한다.

### 삽질 2: GIT_STRATEGY 설정

기본적으로 GitLab CI는 잡 실행 전에 `git checkout`을 수행한다. 이 파이프라인은 파일 전송만 하면 되니 git checkout이 불필요하다. 오히려 불필요한 clone이 느림을 유발했다.

```yaml
variables:
  GIT_STRATEGY: none   # git checkout 비활성화
```

`GIT_STRATEGY: none`으로 설정하면 잡 시작 시 git 작업을 하지 않는다. scp-transfer 단계에서 필요한 파일만 직접 `git clone`해서 가져온다.

### 삽질 3: CI 인증 토큰

scp-transfer 단계에서 레포를 clone할 때 처음에 커스텀 변수 `CI_REPO_TOKEN`을 사용했다.

```yaml
# 실패한 방법 — 토큰 권한 문제
git clone "https://user:${CI_REPO_TOKEN}@gitlab.x2bee.com/..."
```

GitLab CI/CD에는 `CI_JOB_TOKEN`이라는 자동 발급 토큰이 있다. 이 토큰은 현재 파이프라인 실행 중에만 유효하고, 레포 read 권한이 자동으로 부여된다.

```yaml
# 성공한 방법 — CI_JOB_TOKEN 사용
git clone "https://gitlab-ci-token:${CI_JOB_TOKEN}@gitlab.x2bee.com/..."
```

`gitlab-ci-token`이라는 고정된 사용자명과 `CI_JOB_TOKEN`을 조합하는 게 GitLab 공식 방식이다. 별도로 Personal Access Token을 발급하고 CI 변수로 등록할 필요가 없다.

### 삽질 4: 소스 파일 경로

```yaml
# 잘못된 경로 — 변수 이름이 정의되지 않음
SOURCE_FILE_PATH="$SOURCE_DIR/$WORD_TXT"

# 올바른 경로 — clone한 디렉토리 기준 절대경로
SOURCE_FILE_PATH="$(pwd)/temp/files/${WORD_TXT}"
```

### 삽질 5: EC2 대상 경로

OpenSearch 컨테이너가 실제로 synonym.txt를 읽는 경로가 처음 설정과 달랐다.

```yaml
# 초기 설정 — 실제 마운트 경로와 다름
EC2_TARGET_DIR: "/home/ubuntu/opensearch/conf"

# 실제 경로 — OpenSearch Docker 마운트 포인트
EC2_TARGET_DIR: "/data/opensearch-dir/docker-file/conf"
```

EC2 서버에서 Docker Compose 설정을 직접 확인해서 마운트 경로를 찾아냈다.

## 최종 .gitlab-ci.yml

```yaml
image: alpine:latest

stages:
  - check-vars
  - mkdir-target-dir
  - scp-transfer
  - confirm-files

variables:
  GIT_STRATEGY: none
  EC2_TARGET_DIR: "/data/opensearch-dir/docker-file/conf"
  WORD_TXT: "synonym.txt"

# 공통 템플릿 — SSH 키 설정
.default-job-template:
  tags:
    - gitlab-runner-shell
  before_script:
    - mkdir -p ~/.ssh
    - echo "$EC2_SSH_KEY" > ~/.ssh/id_rsa
    - chmod 600 ~/.ssh/id_rsa

# 실행 조건 — main 브랜치 + "run"으로 시작하는 커밋 or 파이프라인 트리거
.default-rules:
  rules:
    - if: '$CI_COMMIT_BRANCH == "main" && $CI_COMMIT_MESSAGE =~ /^run.*/'
      exists:
        - synonym.txt
      when: always
    - if: '$CI_PIPELINE_SOURCE == "trigger"'
      when: always
    - when: never

check-vars:
  stage: check-vars
  extends: [.default-job-template, .default-rules]
  script:
    - echo "EC2 호스트 $EC2_HOST"
    - echo "대상 디렉토리 $EC2_TARGET_DIR"

mkdir-target-dir:
  stage: mkdir-target-dir
  extends: [.default-job-template, .default-rules]
  script:
    - ssh -o StrictHostKeyChecking=no "$EC2_HOST" "mkdir -p $EC2_TARGET_DIR"
  needs: ["check-vars"]

scp-transfer:
  stage: scp-transfer
  extends: [.default-job-template, .default-rules]
  script:
    - git clone --depth 1
        "https://gitlab-ci-token:${CI_JOB_TOKEN}@gitlab.x2bee.com/tech-team/ai-team/search/search-rust.git"
        temp
    - |
      SOURCE_FILE_PATH="$(pwd)/temp/files/${WORD_TXT}"
      scp -o StrictHostKeyChecking=no \
          "$SOURCE_FILE_PATH" \
          "$EC2_HOST:$EC2_TARGET_DIR/$WORD_TXT"
  needs: ["mkdir-target-dir"]

confirm-files:
  stage: confirm-files
  extends: [.default-job-template, .default-rules]
  script:
    - ssh -o StrictHostKeyChecking=no "$EC2_HOST" "ls -al $EC2_TARGET_DIR"
  needs: ["scp-transfer"]
```

## GitLab CI 변수 설정

파이프라인에서 사용하는 민감한 정보는 GitLab 프로젝트 Settings > CI/CD > Variables에 등록했다.

| 변수명 | 설명 | Masked |
|--------|------|--------|
| `EC2_HOST` | `ubuntu@xxx.xxx.xxx.xxx` 형식 | No |
| `EC2_SSH_KEY` | EC2 접속용 private key (-----BEGIN...) | Yes |

`EC2_SSH_KEY`는 반드시 Masked로 설정해야 파이프라인 로그에 키가 노출되지 않는다. `before_script`에서 이 값을 `~/.ssh/id_rsa`로 저장하고 `chmod 600`을 적용한다.

## 파이프라인 API 트리거

검색 엔진 자체에서 CI 파이프라인을 트리거하는 API도 구현했다. 관리자 화면에서 버튼 하나로 동의어 배포를 실행할 수 있도록 하기 위해서다.

```rust
// src/routes/pipeline/routes.rs
async fn trigger_gitlab_pipeline(
    state: Arc<AppState>,
) -> Result<Json<PipelineResponse>, AppError> {
    let url = format!(
        "{}/api/v4/projects/{}/trigger/pipeline",
        gitlab_host,
        project_id
    );

    let response = client
        .post(&url)
        .form(&[
            ("token", &trigger_token),
            ("ref", &"main".to_string()),
        ])
        .send()
        .await?;

    let pipeline: PipelineResponse = response.json().await?;
    Ok(Json(pipeline))
}
```

GitLab Project Settings > CI/CD > Pipeline triggers에서 트리거 토큰을 발급받아 사용했다. 이 토큰은 파이프라인 실행만 허용하고 레포 접근 권한은 없다.

`.default-rules`에 `$CI_PIPELINE_SOURCE == "trigger"` 조건을 추가한 이유가 여기 있다. API 트리거로 실행된 경우 커밋 메시지 조건(run으로 시작)과 무관하게 파이프라인이 실행되어야 했다.

## 실행 결과

파이프라인이 완성된 이후 동의어 배포 흐름은 다음과 같다.

```
1. 팀원이 files/synonym.txt 수정 후 커밋
   git commit -m "run: 신규 동의어 추가 (운동화, 스니커즈)"

2. GitLab CI 자동 실행
   check-vars → mkdir-target-dir → scp-transfer → confirm-files

3. EC2 confirm 단계 로그:
   -rw-r--r-- 1 ubuntu ubuntu 2847 Apr 10 14:23 synonym.txt

4. OpenSearch가 파일 변경 감지 → 동의어 사전 자동 갱신
```

팀원이 GitLab에 커밋하면 5분 이내에 OpenSearch에 동의어가 반영된다. 이전에는 개발자가 EC2에 직접 접속해서 복사하는 작업이 필요했지만 이제 커밋 한 번으로 끝난다.

## 핵심 정리

CI/CD로 파일 배포를 자동화할 때 막히는 포인트들이다.

- **runner executor 확인**: SSH 키를 직접 다루려면 Shell executor. Docker executor에서는 호스트 SSH 설정에 접근하기 어렵다
- **GIT_STRATEGY: none**: 소스 checkout이 불필요한 파이프라인에서는 끄는 게 맞다. 필요한 파일만 직접 clone
- **CI_JOB_TOKEN**: 레포 clone 인증에 쓸 수 있는 자동 발급 토큰. 별도 PAT 관리 불필요
- **StrictHostKeyChecking=no**: CI 환경에서 known_hosts 없이 SSH 접속 시 필수. 운영 환경에서는 known_hosts를 명시하는 게 더 안전하다
