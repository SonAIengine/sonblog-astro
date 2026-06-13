---
title: Rust 검색 엔진의 CI/CD 파이프라인 구축 (GitLab + EC2)
description: GitLab CI/CD로 Rust 검색 엔진의 동의어 사전 파일을 EC2에 자동 배포하고, 애플리케이션 내부에서 파이프라인을
  트리거하는 구조를 설계한 과정.
pubDatetime: 2025-04-10
tags:
- Rust
- CI/CD
- GitLab
- 검색엔진
- EC2
- 자동배포
- DevOps
- 파이프라인
- 인프라
- 자동화
- Search Engine
series: Rust 커머스 검색 엔진
seriesOrder: 9
---

## 개요

검색 엔진을 운영하다 보면 코드 배포 외에도 "설정 파일 배포"가 필요한 순간이 온다. 대표적인 것이 동의어(synonym) 사전이다. OpenSearch의 동의어 사전은 인덱스 생성 시점이 아니라 분석기(analyzer)가 로드하는 시점에 파일을 읽는다. 동의어를 추가하거나 수정하면 해당 파일을 OpenSearch 노드에 배포하고, 인덱스를 닫았다 열어야(close/open) 반영된다.

이 작업을 수동으로 하면 실수가 발생한다. 파일을 잘못된 경로에 올리거나, 권한 설정을 빠뜨리거나, 인덱스 재오픈을 잊거나. GitLab CI/CD로 이 과정을 자동화하고, 추가로 Rust 애플리케이션 내부에서 파이프라인을 트리거하는 API까지 구현했다.

## 아키텍처 설계

### 전체 파이프라인 구조

```mermaid
flowchart TD
    subgraph 트리거
        Manual["수동 커밋 run 접두어"]
        API["Rust API POST /pipeline/trigger"]
    end

    subgraph GitLab_CICD["GitLab CI/CD"]
        CheckVars["1. 변수 확인"]
        MkDir["2. 대상 디렉토리 생성"]
        SCP["3. SCP 파일 전송"]
        Confirm["4. 파일 확인"]

        CheckVars --> MkDir --> SCP --> Confirm
    end

    subgraph EC2["EC2 OpenSearch"]
        ConfDir["/data/opensearch-dir/docker-file/conf"]
        OS[(OpenSearch)]
        ConfDir --> OS
    end

    Manual --> CheckVars
    API --> CheckVars
    SCP --> ConfDir
```

두 가지 트리거 경로를 지원한다. 첫째, 커밋 메시지가 `run`으로 시작하면 자동으로 파이프라인이 실행된다. 둘째, Rust 애플리케이션에서 GitLab Pipeline Trigger API를 호출해서 원격으로 실행할 수 있다. 관리 화면에서 동의어를 수정하고 "배포" 버튼을 누르면 파이프라인이 돌아가는 구조다.

### 왜 GitLab CI/CD인가

동의어 파일 하나 배포하는 데 CI/CD가 필요한가? 라는 의문이 들 수 있다. SCP 명령어 하나면 되지 않는가?

문제는 환경이 여러 개라는 것이다. dev, stg, prd 환경마다 OpenSearch 노드가 다르고, 파일 경로도 다르다. 수동으로 하면 반드시 실수가 생긴다. CI/CD로 자동화하면 환경별 변수를 GitLab Variables에서 관리하고, 파이프라인이 해당 환경에 맞는 설정으로 실행된다. 배포 이력도 GitLab에 남아서 롤백이 가능하다.

## GitLab CI/CD 설정

### .gitlab-ci.yml 구조

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
```

Alpine Linux 이미지를 사용한다. 경량 이미지에 SSH 클라이언트만 설치하면 되므로 파이프라인 시작 시간이 빠르다. `GIT_STRATEGY: none`으로 설정해서 Git 체크아웃을 건너뛴다. 동의어 파일은 Git 저장소가 아니라 파이프라인 실행 시 별도로 가져온다.

`EC2_TARGET_DIR`은 처음에 `/home/ubuntu/opensearch/conf`였다가 `/data/opensearch-dir/docker-file/conf`로 변경했다. EC2에서 OpenSearch를 Docker로 운영하고 있어, Docker 볼륨 마운트 경로에 맞춰야 했다. 이런 경로 변경이 여러 번 있었기 때문에 변수로 관리하는 것이 맞았다.

### SSH 키 공통 템플릿

모든 Job에서 SSH 접속이 필요하므로 공통 템플릿으로 분리했다.

```yaml
.default-job-template:
  tags:
    - runners-runners-project
  before_script:
    - echo "1. ssh before_script"
    - apk add --no-cache openssh-client curl git
    - mkdir -p ~/.ssh
    - echo "$EC2_SSH_KEY" > ~/.ssh/id_rsa
    - chmod 600 ~/.ssh/id_rsa
    - echo "1. SSH 키 구성 완료."
```

`$EC2_SSH_KEY`는 GitLab CI/CD Variables에 저장된 EC2 SSH 프라이빗 키다. `runners-runners-project` 태그로 특정 Runner에서만 실행되도록 제한한다. 보안상 SSH 키에 접근할 수 있는 Runner를 한정하는 것이 좋다.

### 실행 조건 (Rules)

```yaml
.default-rules:
  rules:
    - if: '$CI_COMMIT_BRANCH == "main" && $CI_COMMIT_MESSAGE =~ /^run.*/'
      exists:
        - synonym.txt
      when: always
    - if: '$CI_PIPELINE_SOURCE == "trigger"'
      when: always
    - when: never
```

세 가지 조건 중 하나를 만족해야 파이프라인이 실행된다.

1. `main` 브랜치에 커밋하고, 커밋 메시지가 `run`으로 시작하며, `synonym.txt` 파일이 존재할 때
2. API 트리거로 실행했을 때 (`CI_PIPELINE_SOURCE == "trigger"`)
3. 그 외에는 실행하지 않음

`exists` 조건으로 동의어 파일이 실제로 존재하는지 확인한다. 파일 없이 파이프라인이 돌아가면 SCP 단계에서 실패하므로, 사전에 차단하는 것이 낫다.

### 4단계 파이프라인

**Stage 1: 변수 확인**

```yaml
check-vars:
  stage: check-vars
  extends:
    - .default-job-template
    - .default-rules
  script:
    - echo "2. 변수 확인 중..."
    - echo "EC2 호스트 $EC2_HOST"
    - echo "대상 디렉토리 $EC2_TARGET_DIR"
    - ls -la synonym.txt || echo "소스 파일이 존재하지 않음"
```

파이프라인 시작 시 필수 변수와 파일 존재 여부를 로깅한다. 파이프라인이 실패했을 때 디버깅을 위해 환경 정보를 남기는 용도다.

**Stage 2: 대상 디렉토리 생성**

```yaml
mkdir-target-dir:
  stage: mkdir-target-dir
  extends:
    - .default-job-template
    - .default-rules
  script:
    - ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_rsa $EC2_USER@$EC2_HOST "mkdir -p $EC2_TARGET_DIR"
```

EC2에 대상 디렉토리가 없으면 생성한다. `mkdir -p`라서 이미 존재해도 에러가 나지 않는다. `StrictHostKeyChecking=no`는 처음 접속할 때 호스트 키 확인 프롬프트를 건너뛴다. CI/CD 환경에서는 인터랙티브하게 응답할 수 없으므로 필요한 설정이다.

**Stage 3: SCP 파일 전송**

```yaml
scp-transfer:
  stage: scp-transfer
  extends:
    - .default-job-template
    - .default-rules
  script:
    - |
      if [ -f "synonym.txt" ]; then
        echo "프로젝트 내 synonym.txt 파일 발견"
      else
        echo "프로젝트 내 파일이 없어 저장소에서 가져옵니다."
        git clone --depth 1 "https://gitlab-ci-token:${CI_JOB_TOKEN}@gitlab.x2bee.com/tech-team/ai-team/search/search-rust.git" temp
        cp "temp/synonym.txt" "./synonym.txt" || echo "파일 복사 실패"
        rm -rf temp
      fi
    - scp -o StrictHostKeyChecking=no -i ~/.ssh/id_rsa "./synonym.txt" "$EC2_USER@$EC2_HOST:$EC2_TARGET_DIR/$WORD_TXT"
```

여기서 중요한 삽질 경험이 있다. `GIT_STRATEGY: none`으로 설정했기 때문에 파이프라인 실행 시 프로젝트 파일이 워크스페이스에 없다. 동의어 파일이 로컬에 없으면 `git clone`으로 저장소에서 가져온다.

초기에는 `$CI_REPO_USER`와 `$CI_REPO_TOKEN` 변수를 사용해서 clone했는데, 토큰 만료 문제가 있었다. GitLab CI/CD가 각 Job에 자동으로 발급하는 `$CI_JOB_TOKEN`을 사용하도록 변경해서 해결했다. `gitlab-ci-token:${CI_JOB_TOKEN}` 형식으로 인증하면 별도의 토큰 관리가 필요 없다.

`--depth 1`로 최신 커밋만 가져와서 clone 시간을 최소화한다.

**Stage 4: 파일 확인**

```yaml
confirm-files:
  stage: confirm-files
  extends:
    - .default-job-template
    - .default-rules
  script:
    - ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_rsa $EC2_USER@$EC2_HOST "ls -la $EC2_TARGET_DIR/$WORD_TXT && head -5 $EC2_TARGET_DIR/$WORD_TXT"
```

전송된 파일이 실제로 존재하는지, 내용이 올바른지 확인한다. `head -5`로 파일의 처음 5줄을 출력해서 빈 파일이 전송되지 않았는지 검증한다.

### 파이프라인 실행 흐름

```mermaid
sequenceDiagram
    participant Dev as 개발자/API
    participant GL as GitLab
    participant Runner as GitLab Runner
    participant EC2 as EC2 (OpenSearch)

    Dev->>GL: 커밋 (run synonym update) 또는 API trigger
    GL->>Runner: 파이프라인 시작
    
    Note over Runner: Stage 1: check-vars
    Runner->>Runner: 변수 및 파일 존재 확인
    
    Note over Runner: Stage 2: mkdir-target-dir
    Runner->>EC2: SSH: mkdir -p /data/.../conf
    EC2-->>Runner: OK
    
    Note over Runner: Stage 3: scp-transfer
    alt 로컬 파일 존재
        Runner->>Runner: synonym.txt 사용
    else 로컬 파일 없음
        Runner->>GL: git clone (CI_JOB_TOKEN)
        GL-->>Runner: synonym.txt
    end
    Runner->>EC2: SCP: synonym.txt 전송
    EC2-->>Runner: OK
    
    Note over Runner: Stage 4: confirm-files
    Runner->>EC2: SSH: ls -la && head -5
    EC2-->>Runner: 파일 정보 반환
    
    Runner-->>GL: 파이프라인 완료
```

## Rust 애플리케이션에서 파이프라인 트리거

### 설정 파일에 GitLab 정보 추가

파이프라인을 코드에서 트리거하려면 GitLab API 정보가 필요하다. `Cargo.toml`의 메타데이터로 환경별 설정을 관리한다.

```toml
[package.metadata.config.dev]
# ... 기존 설정
# GitLab 파이프라인 설정
gitlab_host = "https://gitlab.x2bee.com"
gitlab_project_id = "tech-team/ai-team/search/search-rust"
gitlab_token = "glptt-xxxxx"  # 환경 변수로 오버라이드
gitlab_ref = "main"
```

모든 환경(dev, stg, prd)에 같은 구조로 설정을 넣되, 토큰은 환경 변수로 오버라이드한다. 코드에 토큰을 하드코딩하면 보안 문제가 있으므로, 운영 환경에서는 반드시 환경 변수를 사용한다.

### AppConfig 확장

```rust
#[derive(Debug, Clone)]
pub struct AppConfig {
    // ... 기존 필드
    pub gitlab_host: Option<String>,
    pub gitlab_project_id: Option<String>,
    pub gitlab_token: Option<String>,
    pub gitlab_ref: Option<String>,
}
```

환경 변수 오버라이드도 추가했다.

```rust
// GitLab 관련 환경 변수 오버라이드
if let Ok(gitlab_host) = env::var("GITLAB_HOST") {
    config.gitlab_host = Some(gitlab_host);
    println!("Using GITLAB_HOST from environment");
}

if let Ok(gitlab_project_id) = env::var("GITLAB_PROJECT_ID") {
    config.gitlab_project_id = Some(gitlab_project_id);
    println!("Using GITLAB_PROJECT_ID from environment");
}

if let Ok(gitlab_token) = env::var("GITLAB_TOKEN") {
    config.gitlab_token = Some(gitlab_token);
    println!("Using GITLAB_TOKEN from environment");
}

if let Ok(gitlab_ref) = env::var("GITLAB_REF") {
    config.gitlab_ref = Some(gitlab_ref);
    println!("Using GITLAB_REF from environment");
}
```

설정 파일보다 환경 변수가 우선한다. Docker 환경이나 K8s에서는 환경 변수로 설정을 주입하는 것이 일반적이므로, 이 패턴이 필수적이다.

### Pipeline 트리거 API

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineResponse {
    success: bool,
    code: String,
    message: String,
}

impl PipelineResponse {
    pub fn success() -> Self {
        Self {
            success: true,
            code: "0000".to_string(),
            message: "파이프라인 호출 성공".to_string(),
        }
    }

    pub fn error(code: String, message: String) -> Self {
        Self {
            success: false,
            code,
            message,
        }
    }
}
```

트리거 함수는 GitLab Pipeline API를 호출한다.

```rust
async fn trigger_gitlab_pipeline() -> Result<(), AppError> {
    info!("GitLab 파이프라인 트리거 시작");

    let app_config = config::load_config();

    let client = Client::new();
    let gitlab_host = app_config
        .gitlab_host
        .unwrap_or_else(|| "https://gitlab.x2bee.com".to_string());

    let gitlab_project_id = app_config
        .gitlab_project_id
        .ok_or_else(|| AppError::new("500", "GitLab project ID not configured"))?;

    let gitlab_token = app_config
        .gitlab_token
        .ok_or_else(|| AppError::new("500", "GitLab token not configured"))?;

    let gitlab_ref = app_config
        .gitlab_ref
        .unwrap_or_else(|| "main".to_string());

    // URL 인코딩된 프로젝트 ID
    let encoded_project_id = urlencoding::encode(&gitlab_project_id);

    let url = format!(
        "{}/api/v4/projects/{}/pipeline",
        gitlab_host, encoded_project_id
    );

    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", &gitlab_token)
        .json(&serde_json::json!({
            "ref": gitlab_ref
        }))
        .send()
        .await
        .map_err(|e| AppError::new("500", &format!("Pipeline trigger failed: {}", e)))?;

    if response.status().is_success() {
        info!("GitLab 파이프라인 트리거 성공");
        Ok(())
    } else {
        let error_text = response.text().await.unwrap_or_default();
        error!("GitLab 파이프라인 트리거 실패: {}", error_text);
        Err(AppError::new("500", &format!("Pipeline trigger failed: {}", error_text)))
    }
}
```

프로젝트 ID가 `tech-team/ai-team/search/search-rust` 형태의 경로이므로 URL 인코딩이 필요하다. `urlencoding::encode`로 슬래시를 `%2F`로 변환한다. GitLab API는 프로젝트 ID로 숫자 ID나 URL 인코딩된 경로를 모두 지원한다.

### 라우터 등록

```rust
pub fn pipeline_routes() -> Router {
    Router::new()
        .route("/pipeline/trigger", post(trigger_pipeline_handler))
}
```

메인 라우터에 병합한다.

```rust
let app = Router::new()
    .route("/health", get(health_check))
    .merge(search_routes())
    .merge(indexing_routes())
    .merge(pipeline_routes());
```

관리자 UI에서 동의어 사전을 수정한 후 이 API를 호출하면, GitLab 파이프라인이 실행되어 EC2에 파일이 배포된다.

## 트러블슈팅

### GIT_STRATEGY와 파일 가용성

`GIT_STRATEGY: fetch`에서 `GIT_STRATEGY: none`으로 변경한 이유가 있다. `fetch`를 사용하면 매 Job 실행 시 프로젝트 전체를 가져온다. Rust 프로젝트의 `target` 디렉토리, Cargo 의존성 캐시까지 포함하면 수백 MB다. 동의어 파일 하나를 배포하는 데 이 오버헤드는 과했다.

`none`으로 변경하면서 파일이 로컬에 없는 문제가 생겼다. 해결책으로 `git clone --depth 1`을 사용해 최소한의 데이터만 가져온다. 전체 히스토리가 필요 없고, 최신 커밋의 `synonym.txt`만 있으면 된다.

### CI_JOB_TOKEN vs 개인 토큰

초기에는 개인 Access Token을 CI/CD Variables에 넣어서 사용했다. 토큰이 만료되면 파이프라인이 실패하고, 갱신하려면 수동으로 Variables를 업데이트해야 했다.

`$CI_JOB_TOKEN`은 GitLab이 각 파이프라인 Job에 자동으로 발급하는 토큰이다. Job이 끝나면 토큰도 만료되므로 보안 위험이 적고, 갱신 관리도 필요 없다. 다만 `CI_JOB_TOKEN`의 권한 범위가 제한적이므로, 같은 프로젝트의 저장소에만 접근 가능하다. 다른 프로젝트의 파일이 필요하다면 Group Token이나 Project Token을 사용해야 한다.

### EC2 대상 경로 변경

OpenSearch를 EC2에서 직접 실행하다가 Docker로 전환하면서 파일 경로가 변경되었다. `/home/ubuntu/opensearch/conf`에서 `/data/opensearch-dir/docker-file/conf`로 바뀌었다. Docker 볼륨 마운트 포인트에 맞춰야 OpenSearch 컨테이너에서 파일을 읽을 수 있다.

`EC2_TARGET_DIR` 변수를 CI/CD Variables에서 관리하고 있었기 때문에, `.gitlab-ci.yml`의 기본값만 변경하면 되었다. 환경별로 다른 경로가 필요하면 Variables에서 오버라이드한다.

### Runner에서 SSH 접속 실패

파이프라인이 간헐적으로 `Connection refused`로 실패하는 경우가 있었다. EC2 인스턴스의 보안 그룹(Security Group)에서 GitLab Runner의 IP를 허용하지 않아서였다. Runner가 공유 Runner일 경우 IP가 매번 바뀔 수 있다. 전용 Runner를 사용하거나, VPN을 통해 접속하는 방식으로 해결해야 한다.

현재는 `runners-runners-project` 태그를 가진 전용 Runner를 사용하고, 이 Runner의 고정 IP를 EC2 보안 그룹에 등록했다.

### 커밋 메시지 트리거의 반복 실행 문제

`run`으로 시작하는 커밋 메시지가 파이프라인을 트리거하는데, 개발 중에 `run test`, `run fix` 같은 커밋을 여러 번 푸시하면서 파이프라인이 불필요하게 반복 실행되는 문제가 있었다.

`.gitlab-ci.yml` 커밋 이력을 보면 `run Update .gitlab-ci.yml file`이라는 메시지로 12번 이상 커밋한 흔적이 있다. CI/CD 설정을 디버깅하면서 매번 파이프라인이 돌아간 것이다. 리소스 낭비를 방지하려면 커밋 메시지 패턴을 더 구체적으로 설정하거나(`run deploy synonym`), 수동 트리거(API) 방식을 기본으로 사용하는 것이 낫다.

## 개선 방향

### 파이프라인 → OpenSearch 인덱스 재오픈 자동화

현재 파이프라인은 파일 배포까지만 자동화했다. 동의어가 실제로 적용되려면 OpenSearch 인덱스를 close/open해야 한다. 이 단계를 파이프라인에 추가하면 완전 자동화가 된다.

```mermaid
flowchart LR
    SCP[SCP 전송] --> Close[인덱스 Close]
    Close --> Open[인덱스 Open]
    Open --> Verify[동의어 적용 검증]
```

OpenSearch REST API로 인덱스를 close/open하는 것은 간단하다. 하지만 운영 환경에서 인덱스를 닫으면 해당 인덱스에 대한 검색이 잠시 불가능하다. 블루-그린 방식으로 새 인덱스를 생성하고 별칭(alias)을 전환하는 방식이 더 안전하다.

### 다중 환경 배포

현재는 하나의 EC2에만 배포한다. 여러 환경(dev, stg, prd)에 순차적으로 배포하려면 GitLab Environment 기능을 활용할 수 있다.

```yaml
deploy-dev:
  stage: deploy
  environment:
    name: dev
  variables:
    EC2_HOST: $DEV_EC2_HOST
  # ...

deploy-stg:
  stage: deploy
  environment:
    name: stg
  variables:
    EC2_HOST: $STG_EC2_HOST
  needs: [deploy-dev]
  when: manual  # 수동 승인
```

`needs`와 `when: manual`을 조합하면 dev에 배포 후 수동 승인을 거쳐 stg에 배포하는 게이트를 만들 수 있다.

## 결과 및 회고

### 성과

동의어 사전 배포가 완전히 자동화되었다. 관리자 UI에서 동의어를 수정하면 Rust API가 GitLab 파이프라인을 트리거하고, 파이프라인이 EC2에 파일을 배포한다. 수동 SSH 접속과 파일 복사가 사라지면서 휴먼 에러가 제거되었다.

파이프라인 실행 이력이 GitLab에 남아서, "이 동의어가 언제 배포되었는지" 추적할 수 있다. 문제가 생기면 이전 커밋의 동의어 파일로 빠르게 롤백할 수 있다.

### 배운 점

CI/CD 파이프라인 디버깅은 시간이 많이 걸린다. 로컬에서 테스트할 수 없고, 매번 커밋-푸시-실행-로그 확인 사이클을 거쳐야 한다. `run Update .gitlab-ci.yml file` 커밋이 12번 반복된 것이 그 증거다. GitLab CI/CD에는 `gitlab-runner exec` 명령으로 로컬 테스트가 가능하지만, Docker-in-Docker 환경이 필요하고 제약 사항도 있다. 그래도 가능하면 로컬에서 먼저 테스트하는 것이 시간을 절약한다.

설정 파일 배포와 코드 배포는 분리하는 것이 좋다. 동의어 사전은 코드 변경 없이 자주 업데이트된다. 코드 배포 파이프라인과 동의어 배포 파이프라인을 분리하면 각각 독립적으로 실행할 수 있다.

GitLab CI/CD의 `$CI_JOB_TOKEN`은 프로젝트 간 인증에서 강력한 도구다. 개인 토큰을 사용하면 토큰 만료, 권한 변경, 퇴사자 처리 등 관리 포인트가 늘어난다. CI/CD 전용 토큰을 사용하면 이런 문제에서 자유로워진다.

애플리케이션 내부에서 CI/CD를 트리거하는 패턴은 "설정 변경 → 배포"를 원자적 작업으로 만들어준다. 사용자가 관리 화면에서 변경하고 배포까지 클릭 한 번으로 끝나므로, 운영 효율이 크게 향상된다.
