---
title: YAML + 환경변수 이중 설정 파싱 시스템
description: Rust Gateway에서 YAML 파일과 환경변수를 결합한 다중 계층 설정 관리 시스템 구현
pubDatetime: 2025-10-28
tags:
- Rust
- Configuration
- YAML
- Environment Variables
- serde
- Full Stack
---


## 배경: 설정 관리가 문제가 되기까지

XGEN 2.0 백엔드 게이트웨이(xgen-backend-gateway)는 Rust + Axum으로 작성한 API Gateway다. 프론트엔드의 모든 API 요청을 받아서 인증 처리 후 내부 마이크로서비스로 프록시한다. 이 게이트웨이가 정상 동작하려면 다음 정보가 반드시 필요하다.

- PostgreSQL 연결 URL
- Redis 연결 URL
- 내부 서비스 호스트/포트 매핑 (xgen-core, xgen-documents, xgen-workflow 등)
- 외부 서비스 URL (MinIO, Qdrant)
- Swagger UI 활성화 여부

문제는 이 게이트웨이가 3가지 완전히 다른 환경에서 실행된다는 점이었다.

| 환경 | DB 호스트 | 서비스 호스트 | 특징 |
|------|----------|-------------|------|
| K3s (운영/스테이징) | `postgresql.xgen-system.svc.cluster.local` | `xgen-core:8000` | 클러스터 내부 DNS |
| Docker Compose (팀 개발) | `postgresql` (컨테이너명) | `xgen-core:8000` | Docker 네트워크 DNS |
| 로컬 (개별 개발) | `localhost:5432` | `localhost:8001~8009` | 직접 실행 |

초기에는 이 설정을 어떻게 관리했느냐 하면, `.env` 파일 하나와 `services.yaml` 하나로 운영했다.

```bash
# .env (초기 형태)
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=plateerag
POSTGRES_USER=ailab
POSTGRES_PASSWORD=ailab123
```

```rust
// main.rs (초기 형태) - 환경변수 조합으로 DB URL 생성
let database_url = std::env::var("DATABASE_URL")
    .unwrap_or_else(|_| {
        let user = std::env::var("POSTGRES_USER").unwrap_or_else(|_| "plateer".to_string());
        let password = std::env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "plateer123!".to_string());
        let host = std::env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string());
        let port = std::env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".to_string());
        let db = std::env::var("POSTGRES_DB").unwrap_or_else(|_| "plateer".to_string());
        format!("postgres://{}:{}@{}:{}/{}", user, password, host, port, db)
    });
```

Redis도 마찬가지였다.

```rust
// security.rs (초기 형태) - Redis URL도 환경변수 조합
fn redis_url_from_env() -> String {
    if let Ok(url) = std::env::var("REDIS_URL") { return url; }
    let host = std::env::var("REDIS_HOST").unwrap_or_else(|_| "redis-feature-store".into());
    let port = std::env::var("REDIS_PORT").unwrap_or_else(|_| "6379".into());
    let password = std::env::var("REDIS_PASSWORD").unwrap_or_else(|_| "redis_secure_password123!".into());
    let db = std::env::var("REDIS_DB").unwrap_or_else(|_| "0".into());
    if password.is_empty() {
        format!("redis://{}:{}/{}", host, port, db)
    } else {
        format!("redis://:{}@{}:{}/{}", password, host, port, db)
    }
}
```

이 방식의 문제점은 명확했다.

1. **환경변수 폭발**: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` 총 5개 환경변수로 하나의 DB URL을 만들었다. Redis까지 합하면 10개가 넘었다.
2. **`.env` 파일 충돌**: `.env` 파일을 `.gitignore`에 넣으면 새 팀원이 뭘 설정해야 하는지 모르고, git에 넣으면 비밀번호가 노출됐다.
3. **서비스 호스트 하드코딩**: `services.yaml`에 K3s 기준 호스트가 하드코딩되어 있어서 로컬에서 테스트하려면 파일을 수정해야 했다. 되돌리기를 잊고 커밋하면 배포가 깨졌다.
4. **설정 산재**: DB URL은 `main.rs`에서, Redis URL은 `security.rs`에서, 서비스 매핑은 `config.rs`에서 각각 별도로 관리했다.

이 구조를 "YAML 파일 기반 다계층 설정 시스템"으로 리팩토링한 과정을 정리한다.

## 설계: 3계층 설정 아키텍처

리팩토링의 핵심 아이디어는 설정을 3개 계층으로 분리하고, 상위 계층이 하위 계층을 오버라이드하는 구조다.

```mermaid
flowchart LR
    subgraph "계층 1: config.yml"
        A[APP_SITE + APP_ENV<br/>site/env별 오버라이드]
    end

    subgraph "계층 2: services.yaml"
        B[서비스 매핑 + DB/Redis<br/>환경별 3종 파일]
    end

    subgraph "계층 3: 환경변수"
        C[SERVICE_XXX_URL<br/>개별 모듈 오버라이드]
    end

    A -->|우선| D[GatewayConfig]
    B -->|fallback| D
    C -->|최종 오버라이드| E[get_service_base_url]
```

각 계층의 역할은 다음과 같다.

**계층 1 - config.yml**: 사이트(고객사)와 환경(development/stage/production)의 조합으로 DB URL, Redis URL, 외부 서비스 URL을 결정한다. 예를 들어 롯데홈쇼핑 운영 환경과 자체 개발 환경은 DB 호스트가 다르다. `APP_SITE`와 `APP_ENV` 두 개의 환경변수만으로 전체 설정 프로파일을 선택한다.

**계층 2 - services.yaml**: 마이크로서비스별 호스트와 모듈 매핑을 정의한다. K3s용(`services.yaml`), Docker Compose용(`services.docker.yaml`), 로컬용(`services.local.yaml`) 3종을 분리했다. DB/Redis URL의 기본값도 여기에 포함된다.

**계층 3 - 환경변수**: `SERVICE_{MODULE}_URL` 패턴으로 개별 서비스 URL을 런타임에 오버라이드할 수 있다. 특정 서비스만 로컬에서 디버깅할 때 유용하다.

```mermaid
flowchart LR
    A[게이트웨이 시작] --> B[dotenvy로 .env 로드]
    B --> C[init_service_map_from_file]
    C --> D{SERVICES_CONFIG_FILE<br/>환경변수?}
    D -->|있음| E[해당 경로 로드]
    D -->|없음| F[후보 경로 순회]
    F --> G[/app/config/services.yaml]
    G --> H[config/services.yaml]
    E --> I[ServicesConfig 파싱]
    H --> I
    I --> J[load_site_config]
    J --> K{config.yml 발견?}
    K -->|있음| L[default 설정 로드]
    L --> M[APP_SITE.APP_ENV로<br/>오버라이드 병합]
    M --> N[OnceCell에 캐싱]
    K -->|없음| O[services.yaml<br/>기본값 사용]
    N --> P[GatewayConfig 생성]
    O --> P
```

## 구현: GatewayConfig과 설정 로드 체인

### 설정 구조체

게이트웨이의 핵심 설정을 담는 구조체다. `from_env()` 메서드가 3계층을 순회하며 값을 채운다.

```rust
#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub bind_addr: String,
    pub timeout_ms: u64,
    pub database_url: String,
    pub redis_url: String,
    pub rate_limit_rps: u64,
    pub admin_config_base_url: Option<String>,
    pub docs_page: bool,
}
```

초기 버전에서는 `database_url`과 `redis_url` 필드가 없었다. `main.rs`에서 환경변수를 직접 조합해서 DB에 연결했다. 리팩토링 후 모든 설정 값이 `GatewayConfig` 한 곳에 모였다.

```rust
impl GatewayConfig {
    pub fn from_env() -> Self {
        let bind_addr = std::env::var("BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8000".to_string());
        let timeout_ms = std::env::var("TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(300_000);

        // 계층 1: config.yml에서 site/env별 설정 로드
        let site_config = load_site_config();

        // database_url: config.yml → services.yaml fallback
        let database_url = site_config.as_ref()
            .and_then(|c| c.database_url.clone())
            .or_else(|| database_url_from_services_yaml())
            .expect("DATABASE_URL not found in config.yml or services.yaml");

        // redis_url: 동일 패턴
        let redis_url = site_config.as_ref()
            .and_then(|c| c.redis_url.clone())
            .or_else(|| redis_url_from_services_yaml())
            .expect("REDIS_URL not found in config.yml or services.yaml");

        // docs_page: 동일 패턴
        let docs_page = site_config.as_ref()
            .and_then(|c| c.docs_page)
            .or_else(|| docs_page_from_services_yaml())
            .unwrap_or(false);

        Self { bind_addr, timeout_ms, database_url, redis_url,
               rate_limit_rps, admin_config_base_url, docs_page }
    }
}
```

`and_then().or_else()` 체인이 핵심이다. config.yml에 값이 있으면 사용하고, 없으면 services.yaml에서 찾는다. 두 곳 모두 없으면 `expect()`로 명확한 에러 메시지와 함께 패닉한다. 초기 버전처럼 기본값을 하드코딩하지 않는다. 설정이 없으면 시작하지 않는 게 맞다.

### SiteEnvConfig: site/env별 오버라이드 구조체

config.yml의 각 섹션을 파싱하는 구조체다.

```rust
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SiteEnvConfig {
    #[serde(rename = "DOCS_PAGE")]
    pub docs_page: Option<bool>,
    #[serde(rename = "DATABASE_URL")]
    pub database_url: Option<String>,
    #[serde(rename = "REDIS_URL")]
    pub redis_url: Option<String>,
    pub external: Option<HashMap<String, String>>,
}
```

모든 필드가 `Option`이다. 이유가 있다. 오버라이드 패턴이기 때문이다. `default` 섹션에서 기본값을 로드한 뒤, `site.env` 섹션에서 `Some`인 필드만 덮어쓴다. `None`이면 기본값이 유지된다.

`#[serde(rename = "DOCS_PAGE")]`로 YAML의 대문자 키를 Rust의 snake_case 필드에 매핑했다. serde의 rename 기능을 쓰지 않으면 YAML 키 이름을 `docs_page`로 바꿔야 하는데, 환경변수 네이밍 컨벤션(대문자)을 유지하고 싶었다.

### load_site_config: default + site.env 병합 로직

이 함수가 설정 시스템의 핵심이다.

```rust
pub static SITE_CONFIG: OnceCell<SiteEnvConfig> = OnceCell::new();

fn load_site_config() -> Option<SiteEnvConfig> {
    // OnceCell: 이미 로드됐으면 캐시된 값 반환
    if let Some(config) = SITE_CONFIG.get() {
        return Some(config.clone());
    }

    // APP_SITE, APP_ENV 환경변수로 프로파일 결정
    let site = std::env::var("APP_SITE").unwrap_or_else(|_| "k3s".to_string());
    let env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".to_string());

    // config.yml 경로 후보
    let candidates = vec![
        std::env::var("CONFIG_YML_PATH").ok(),
        Some("/app/config/config.yml".to_string()),
        Some("config/config.yml".to_string()),
    ];

    for path_opt in candidates.into_iter().flatten() {
        if let Ok(content) = std::fs::read_to_string(&path_opt) {
            let yaml_value: serde_yaml::Value = match serde_yaml::from_str(&content) {
                Ok(v) => v,
                Err(e) => {
                    tracing::debug!(%e, path=%path_opt, "Failed to parse config.yml");
                    continue;
                }
            };

            let mapping = match yaml_value.as_mapping() {
                Some(m) => m,
                None => continue,
            };

            // 1단계: default 섹션을 기본값으로 로드
            let mut merged = if let Some(default_val) = mapping.get("default") {
                serde_yaml::from_value::<SiteEnvConfig>(default_val.clone())
                    .unwrap_or_default()
            } else {
                SiteEnvConfig::default()
            };

            // 2단계: site.env 섹션으로 오버라이드
            if let Some(site_val) = mapping.get(&serde_yaml::Value::String(site.clone())) {
                if let Some(site_mapping) = site_val.as_mapping() {
                    if let Some(env_val) = site_mapping.get(
                        &serde_yaml::Value::String(env.clone())
                    ) {
                        if let Ok(env_config) = serde_yaml::from_value::<SiteEnvConfig>(
                            env_val.clone()
                        ) {
                            // Some인 필드만 덮어씀
                            if env_config.docs_page.is_some() {
                                merged.docs_page = env_config.docs_page;
                            }
                            if env_config.database_url.is_some() {
                                merged.database_url = env_config.database_url.clone();
                            }
                            if env_config.redis_url.is_some() {
                                merged.redis_url = env_config.redis_url.clone();
                            }
                            if let Some(ref ext) = env_config.external {
                                let mut merged_ext = merged.external.unwrap_or_default();
                                for (k, v) in ext {
                                    merged_ext.insert(k.clone(), v.clone());
                                }
                                merged.external = Some(merged_ext);
                            }
                        }
                    }
                }
            }

            let _ = SITE_CONFIG.set(merged.clone());
            return Some(merged);
        }
    }

    None
}
```

몇 가지 설계 결정이 있다.

**serde_yaml::Value로 1차 파싱**: config.yml의 최상위 키가 동적이다(`k3s`, `docker`, `xgen-x2bee-io`, `agent-lotteimall-com` 등 고객사별로 달라진다). 이걸 struct로 정적 타입을 잡을 수 없기 때문에 먼저 `serde_yaml::Value`로 파싱한 뒤, 필요한 섹션만 `serde_yaml::from_value::<SiteEnvConfig>()`로 역직렬화한다.

**OnceCell 캐싱**: `load_site_config()`는 `GatewayConfig::from_env()`와 `init_service_map_from_file()` 양쪽에서 호출된다. 파일을 두 번 읽지 않도록 `OnceCell`에 결과를 캐싱한다. `once_cell::sync::OnceCell`이라 멀티스레드 환경에서도 안전하다.

**경로 후보 순회**: 파일 경로를 하드코딩하지 않고 후보 3개를 순회한다. `CONFIG_YML_PATH` 환경변수 > `/app/config/config.yml`(Docker 컨테이너) > `config/config.yml`(로컬 개발). 이 패턴은 services.yaml 로드에서도 동일하게 사용한다.

### config.yml 실제 구조

실제 운영 중인 config.yml의 구조를 보면 이 시스템이 왜 필요했는지 이해된다.

```yaml
# config.yml
# default: 모든 site/env 공통 기본값
default:
  DOCS_PAGE: true
  DATABASE_URL: postgresql://ailab:ailab123@postgresql.xgen-system.svc.cluster.local:5432/plateerag
  REDIS_URL: redis://:redis_secure_password123!@redis.xgen-system.svc.cluster.local:6379
  external:
    minio: http://minio.xgen-system.svc.cluster.local:9000
    qdrant: http://qdrant.xgen-system.svc.cluster.local:6333

# Docker Compose 개발 환경
docker:
  development:
    DOCS_PAGE: true
    DATABASE_URL: postgresql://ailab:dev_password123@postgresql:5432/plateerag_dev
    REDIS_URL: redis://:dev_redis123@redis:6379/0
    external:
      minio: http://minio:9000
      qdrant: http://qdrant:6333

# 고객사별 설정: 롯데홈쇼핑
agent-lotteimall-com:
  development:
    DATABASE_URL: postgres://ailab:ailab123@k3s-host:5432/plateerag
    REDIS_URL: redis://:redis_secure_password123!@k3s-host:6379/0
  production:
    DOCS_PAGE: false  # 운영에서는 Swagger 비활성화
    DATABASE_URL: postgres://ailab:ailab123@k3s-host:5432/plateerag

# x2bee 자체 K3s 클러스터
xgen-x2bee-com:
  development:
    DATABASE_URL: postgresql://ailab:ailab123@postgresql.xgen-system.svc.cluster.local:5432/plateerag
    REDIS_URL: redis://:redis_secure_password123!@redis.xgen-system.svc.cluster.local:6379
  production:
    DOCS_PAGE: false
```

`APP_SITE=agent-lotteimall-com APP_ENV=production`으로 시작하면, `default` 기본값 위에 `agent-lotteimall-com.production` 설정이 덮어씌워진다. `DOCS_PAGE`가 `false`로 바뀌고, DB 호스트가 롯데 전용 호스트로 변경된다.

한 개의 바이너리, 한 개의 Docker 이미지로 모든 고객사 환경을 대응할 수 있다. 환경변수 두 개(`APP_SITE`, `APP_ENV`)만 K8s Deployment에서 바꿔주면 된다.

## 구현: 환경변수 확장(expand_yaml_value)

YAML 파일 안에 `${DATABASE_URL}` 같은 환경변수 참조를 쓸 수 있게 했다. YAML 표준에는 환경변수 확장 기능이 없으므로 직접 구현했다.

```rust
fn expand_yaml_value(raw: &str) -> String {
    let trimmed = raw.trim();
    let unquoted = trimmed.trim_matches('"').trim_matches('\'');
    if unquoted.starts_with("${") && unquoted.ends_with("}") {
        let key = &unquoted[2..unquoted.len()-1];
        std::env::var(key).unwrap_or_default()
    } else {
        unquoted.to_string()
    }
}
```

이 함수가 처리하는 케이스를 정리하면 다음과 같다.

| 입력 | 출력 | 설명 |
|-----|------|------|
| `postgresql://...@host:5432/db` | 그대로 | 일반 문자열 |
| `"postgresql://...@host:5432/db"` | 따옴표 제거 | YAML 따옴표 처리 |
| `${DATABASE_URL}` | 환경변수 값 | 환경변수 확장 |
| `"${DATABASE_URL}"` | 환경변수 값 | 따옴표 + 환경변수 |
| `${NONEXISTENT}` | `""` (빈 문자열) | 미설정 환경변수 |

이 함수는 `database_url_from_services_yaml()`, `redis_url_from_services_yaml()`, `docs_page_from_services_yaml()` 3곳에서 호출된다. services.yaml 파일에서 값을 읽을 때 항상 거치는 파이프라인이다.

### services.yaml에서 값 추출

services.yaml에서 `DATABASE_URL`을 읽는 함수다. YAML 형식(`:`)과 env 형식(`=`) 모두 지원한다. 이중 파서를 만든 이유는 뒤에서 설명한다.

```rust
fn database_url_from_services_yaml() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(p) = std::env::var("SERVICES_CONFIG_FILE") { candidates.push(p); }
    candidates.push("/app/config/services.yaml".into());
    candidates.push("/config/services.yaml".into());
    candidates.push("config/services.yaml".into());

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for raw_line in content.lines() {
                let line = raw_line.trim();
                // YAML 형식: DATABASE_URL: value
                if line.starts_with("DATABASE_URL:") {
                    let val = expand_yaml_value(
                        line.splitn(2, ':').nth(1).unwrap_or("").trim()
                    );
                    if !val.is_empty() { return Some(val); }
                // env 형식: DATABASE_URL=value
                } else if line.starts_with("DATABASE_URL=") {
                    let val = expand_yaml_value(
                        line.splitn(2, '=').nth(1).unwrap_or("").trim()
                    );
                    if !val.is_empty() { return Some(val); }
                }
            }
        }
    }
    None
}
```

`splitn(2, ':')` 대신 단순 `split`을 쓰면 안 된다. PostgreSQL URL에 포트 구분자 `:`가 포함되기 때문이다. `postgresql://user:pass@host:5432/db`에서 첫 번째 `:`로만 분리해야 키(`DATABASE_URL`)와 값(`postgresql://user:pass@host:5432/db`)이 올바르게 분리된다.

## 구현: 서비스 매핑과 모듈 라우팅

서비스 매핑은 "어떤 API 모듈이 어떤 백엔드 서비스에서 실행되는가"를 정의한다.

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct ServiceInfo {
    pub host: String,
    pub modules: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServicesConfig {
    pub base_path: Option<String>,
    pub services: HashMap<String, ServiceInfo>,
    #[serde(default)]
    pub external: HashMap<String, String>,
}
```

`ServicesConfig`는 serde로 직접 역직렬화한다. config.yml과 달리 스키마가 고정되어 있어서 `serde_yaml::Value`로 우회할 필요가 없다.

서비스 매핑 초기화 함수에서 config.yml의 `external` 설정을 병합하는 부분이 핵심이다.

```rust
pub static SERVICES_CONFIG: OnceCell<ServicesConfig> = OnceCell::new();

pub fn init_service_map_from_file() {
    let _ = dotenvy::dotenv(); // .env 로드 (없으면 무시)

    let mut candidates: Vec<String> = Vec::new();
    if let Ok(p) = std::env::var("SERVICES_CONFIG_FILE") { candidates.push(p); }
    candidates.push("/app/config/services.yaml".into());
    candidates.push("/config/services.yaml".into());
    candidates.push("config/services.yaml".into());

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            match serde_yaml::from_str::<ServicesConfig>(&content) {
                Ok(mut config) => {
                    // config.yml의 external 오버라이드 적용
                    if let Some(site_config) = SITE_CONFIG.get() {
                        if let Some(ref site_external) = site_config.external {
                            for (k, v) in site_external {
                                config.external.insert(k.clone(), v.clone());
                            }
                        }
                    }

                    let _ = SERVICES_CONFIG.set(config);
                    return;
                }
                Err(e) => {
                    tracing::warn!(%e, path=%path, "Failed to parse services.yaml");
                }
            }
        }
    }
}
```

`SITE_CONFIG.get()`으로 이미 로드된 config.yml 설정을 참조한다. `load_site_config()`가 먼저 호출되어야 한다. `main.rs`에서 호출 순서를 보장한다.

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    init_service_map_from_file();  // services.yaml 로드 (내부에서 load_site_config 호출)
    let config = GatewayConfig::from_env();  // config.yml 기반 설정 생성
    // ...
}
```

### 모듈 URL 조회: 3단계 fallback

프록시 라우터에서 모듈 이름으로 업스트림 URL을 찾을 때 3단계 fallback이 적용된다.

```rust
pub fn get_service_base_url(module: &str) -> Option<String> {
    // 1) 환경변수 오버라이드: SERVICE_{MODULE}_URL
    if let Some(from_env) = env_override(module) {
        return Some(from_env);
    }

    // 2) services.yaml에서 모듈이 속한 서비스 찾기
    if let Some(url) = find_module_url(module) {
        return Some(url);
    }

    // 3) external 서비스 확인 (minio, qdrant 등)
    if let Some(url) = find_external_service(module) {
        return Some(url);
    }

    None
}
```

환경변수 오버라이드는 `SERVICE_{MODULE}_URL` 패턴이다. 예를 들어 `workflow` 모듈을 로컬에서 디버깅하려면 `SERVICE_WORKFLOW_URL=http://localhost:8002`로 설정하면 된다. 나머지 모듈은 K3s의 서비스를 그대로 사용한다.

```rust
fn env_override(module: &str) -> Option<String> {
    let base = normalize_key(module); // "workflow" → "WORKFLOW"

    let keys = vec![
        format!("SERVICE_{}_URL", base),           // SERVICE_WORKFLOW_URL
        format!("SERVICE_{}_SERVICE_URL", base),    // SERVICE_WORKFLOW_SERVICE_URL
    ];

    for k in keys {
        if let Ok(val) = std::env::var(&k) {
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}
```

## 환경별 설정 파일 비교

services.yaml 3종의 차이를 비교하면 설계 의도가 명확해진다.

### K3s 기본(services.yaml)

```yaml
services:
  xgen-core:
    host: http://xgen-core:8000     # K8s Service 이름
    modules: [admin, auth, config, llm, session-station]
  retrieval-service:
    host: http://xgen-documents:8000
    modules: [retrieval, documents, folder, embedding, data-processor, storage]
  workflow-service:
    host: http://xgen-workflow:8000
    modules: [workflow, interaction, editor, node, tools, prompt, mcp]

external:
  minio: http://minio:9000
  qdrant: http://qdrant:6333

DATABASE_URL: postgres://ailab:ailab123@postgresql:5432/plateerag
REDIS_URL: redis://:redis_secure_password123!@redis:6379/0
```

### Docker Compose(services.docker.yaml)

```yaml
services:
  xgen-core:
    host: http://xgen-core:8000     # Docker 컨테이너명 (K8s와 동일하게 맞춤)
    modules: [admin, auth, config, llm, data, session-station]
  # ...동일 구조...

DATABASE_URL: postgresql://ailab:dev_password123@postgresql:5432/plateerag_dev
REDIS_URL: redis://:dev_redis123@redis:6379/0
```

### 로컬 개발(services.local.yaml)

```yaml
services:
  xgen-core:
    host: http://localhost:8001      # 로컬 포트
    modules: [admin, auth, config, llm, data, session-station]
  retrieval-service:
    host: http://localhost:8003
    modules: [retrieval, documents, folder, embedding, data-processor, storage]
  workflow-service:
    host: http://localhost:8002
    modules: [workflow, interaction, editor, node, tools, prompt, mcp]

external:
  minio: http://localhost:9000
  qdrant: http://localhost:6333

DATABASE_URL: postgres://ailab:ailab123@localhost:5432/plateerag
REDIS_URL: redis://:redis_secure_password123!@localhost:6379/0
```

K3s와 Docker Compose에서 서비스 호스트 이름이 같다(`xgen-core:8000`). Docker Compose의 컨테이너 이름을 K8s Service 이름과 동일하게 맞춘 것이다. 이렇게 하면 Docker Compose 환경이 K8s의 가벼운 시뮬레이션이 된다. 차이는 DB/Redis 주소와 인증 정보뿐이다.

로컬 환경에서는 각 서비스가 서로 다른 포트에서 실행된다(8001~8009). K8s/Docker에서는 모든 서비스가 동일 포트(8000)를 사용하되 호스트명으로 구분한다.

## 트러블슈팅

### .env에서 YAML로 마이그레이션

마이그레이션 과정은 하루 만에 진행했다. 커밋 히스토리를 따라가면 시행착오가 보인다.

```
# 커밋: Add .env file for database configuration
# 날짜: 2025-10-28 19:38
# → 처음에는 .env로 DB 설정을 분리하려 했다

# 커밋: Load environment variables from a local .env file
# 날짜: 2025-10-28 19:35
# → dotenvy로 .env 로드하는 코드 추가

# 커밋: Remove .env entry from .gitignore
# 날짜: 2025-10-28 19:38
# → .env를 git에 추적하려고 .gitignore에서 뺌 (잘못된 판단)

# 커밋: Remove .env file containing database configuration settings
# 날짜: 2025-10-28 20:02
# → 바로 20분 뒤 .env 파일 삭제. 비밀번호가 git에 들어가는 문제를 깨달음

# 커밋: Integrate database and Redis configuration from services.yaml
# 날짜: 2025-10-28 20:02
# → services.yaml에 DATABASE_URL, REDIS_URL 통합
```

처음에는 `.env` 파일로 분리하면 충분하다고 생각했다. 하지만 `.env`를 git에 넣으면 비밀번호가 노출되고, `.gitignore`에 넣으면 신규 팀원이 어떤 변수를 설정해야 하는지 알 수 없다. 결국 `.env`를 완전히 제거하고 services.yaml에 모든 설정을 합쳤다.

`.env` 파일에 있던 내용은 이것이었다.

```bash
# 삭제된 .env 파일 내용
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=plateerag
POSTGRES_USER=ailab
POSTGRES_PASSWORD=ailab123
```

5개 환경변수를 조합해서 DB URL을 만드는 대신, services.yaml에 완성된 URL을 직접 넣었다. 환경변수 조합 로직(6줄)이 사라지고, 파일에서 한 줄 읽는 것으로 대체됐다.

### YAML 형식과 env 형식 혼재 문제

초기 services.yaml에서 DB/Redis URL을 `=`(env 형식)로 작성했다.

```yaml
# 초기 형식 (env 스타일)
DATABASE_URL=postgres://ailab:ailab123@postgres:5432/plateerag
REDIS_URL=redis://:redis_secure_password123!@redis-feature-store:6379/0
```

이걸 YAML 파서(`serde_yaml`)에서는 그냥 문자열로 읽는다. YAML에서 `KEY=VALUE`는 `KEY=VALUE`라는 이름의 키(값 없음)로 해석되거나, YAML 파서에 따라 에러가 날 수 있다. `DATABASE_URL:` 형식(YAML 표준)으로 바꿨지만, 하위 호환을 위해 두 형식을 모두 지원하는 파서를 만들었다.

```
# 커밋: Refactor configuration parsing to support both YAML and environment variable formats
# 날짜: 2025-10-28 21:06
```

이것이 `expand_yaml_value`에서 `:`와 `=` 두 가지 구분자를 모두 처리하는 이유다. 기존 설정 파일이 어떤 형식이든 깨지지 않아야 했다.

### config.yml 오버라이드 우선순위 혼동

config.yml과 services.yaml에 같은 값이 있으면 어느 쪽이 이기는지 혼동이 있었다. 코드를 보면 답은 명확하다.

```rust
let database_url = site_config.as_ref()
    .and_then(|c| c.database_url.clone())   // config.yml이 최우선
    .or_else(|| database_url_from_services_yaml());  // 없으면 services.yaml
```

config.yml이 무조건 우선이다. services.yaml은 fallback이다. 이 우선순위를 팀에 공유하지 않아서, config.yml의 `default` 섹션에 K3s URL이 하드코딩되어 있는데 `SERVICES_CONFIG_FILE`로 `services.local.yaml`을 지정해도 DB URL이 로컬로 바뀌지 않는 문제가 있었다.

해결 방법은 두 가지다.

1. `APP_SITE=local`로 설정해서 config.yml의 로컬 섹션을 사용
2. config.yml에 로컬 환경 설정을 추가

결국 config.yml에 고객사별/환경별 설정을 모두 넣고, `APP_SITE`와 `APP_ENV`로 선택하는 방식으로 통일했다.

### DB 연결 재시도 로직 추가

설정 시스템을 바꾸면서 DB 연결 로직도 개선했다. 기존에는 연결 실패 시 바로 패닉했다.

```rust
// 기존: 연결 실패 = 즉시 종료
let db_pool = PgPool::connect(&config.database_url).await?;
```

Docker Compose나 K8s에서 게이트웨이가 PostgreSQL보다 먼저 시작되면 DB가 아직 준비되지 않았을 수 있다. `depends_on: service_healthy`로 어느 정도 방지하지만, 네트워크 지연이나 DB 초기화 시간 때문에 실패하는 경우가 있었다.

```rust
// 개선: 최대 10회 재시도, 5초 간격
let db_pool = {
    let max_retries = 10;
    let mut retry_count = 0;
    loop {
        match PgPool::connect(&config.database_url).await {
            Ok(pool) => break pool,
            Err(e) => {
                retry_count += 1;
                if retry_count >= max_retries {
                    tracing::error!(
                        error = %e,
                        retries = retry_count,
                        "Failed to connect to database after max retries"
                    );
                    return Err(e.into());
                }
                tracing::warn!(
                    error = %e,
                    retry = retry_count,
                    max_retries = max_retries,
                    "Database connection failed, retrying in 5 seconds..."
                );
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
};
```

Redis도 동일한 패턴으로 재시도를 적용했다. 최대 10회, 5초 간격으로 총 50초 안에 연결되지 않으면 종료한다.

## main.rs의 변화: 설정 일원화 전후 비교

리팩토링 전후의 `main.rs` 코드 변화를 비교하면 설정 일원화의 효과가 드러난다.

```rust
// 리팩토링 전 (main.rs)
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();  // .env 파일 로드
    init_tracing();
    init_service_map_from_file();

    let config = GatewayConfig::from_env();
    let client = reqwest::ClientBuilder::new()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()?;

    // DB URL: 환경변수 6개 조합
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| {
            let user = std::env::var("POSTGRES_USER").unwrap_or_else(|_| "plateer".to_string());
            let password = std::env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "plateer123!".to_string());
            // ...5줄 더...
        });

    let db_pool = sqlx::PgPool::connect(&database_url).await?;

    // Redis: security.rs의 redis_url_from_env() 함수에서 별도 관리
    let state = AppState { client, db_pool };
    // ...
}
```

```rust
// 리팩토링 후 (main.rs)
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    init_service_map_from_file();  // 내부에서 dotenvy::dotenv() 호출

    let config = GatewayConfig::from_env();  // DB, Redis URL이 이미 포함됨
    let client = reqwest::ClientBuilder::new()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()?;

    let db_pool = PgPool::connect(&config.database_url).await?;
    let redis_client = RedisClient::open(config.redis_url.clone())?;

    let state = AppState { client, db_pool, redis_client };
    // ...
}
```

`security.rs`에서 `redis_url_from_env()` 함수가 완전히 제거됐다. Redis 클라이언트를 `AppState`에 넣고 라우터 핸들러에서 주입받는 구조로 바뀌었다. 매 요청마다 Redis 연결을 새로 만드는 대신 앱 시작 시 한 번 연결한다.

## Swagger UI 조건부 활성화

설정 시스템의 부가적인 산출물로, `DOCS_PAGE` 플래그에 따라 Swagger UI를 켜고 끄는 기능이 추가됐다.

```rust
let mut app = Router::new()
    .route("/healthz", get(routes::health::healthz))
    .route("/readyz", get(routes::health::readyz));

if config.docs_page {
    tracing::info!("Swagger UI enabled");
    app = app.merge(
        SwaggerUi::new("/docs")
            .url("/api-docs/openapi.json", ApiDoc::openapi())
    );
}
```

개발/스테이징 환경에서는 `DOCS_PAGE: true`로 Swagger를 활성화해서 API를 테스트하고, 운영 환경에서는 `DOCS_PAGE: false`로 비활성화한다. config.yml의 `production` 섹션에 `DOCS_PAGE: false`를 넣어두면 운영 배포 시 자동으로 Swagger가 꺼진다.

```
# 커밋: Add support for conditional Swagger UI based on configuration
# 날짜: 2025-10-29 13:35
```

## 결과

`.env` 파일 기반의 환경변수 조합 방식에서 YAML 파일 기반 다계층 설정 시스템으로 전환한 결과는 다음과 같다.

- **환경변수 10개 이상 → 2개(`APP_SITE`, `APP_ENV`)**: DB/Redis 연결에 필요한 환경변수가 대폭 줄었다
- **설정 코드 산재 해소**: `main.rs`의 DB URL 조합 코드, `security.rs`의 `redis_url_from_env()` 함수가 모두 `config.rs`로 통합됐다
- **환경별 파일 분리**: services.yaml 3종(K8s, Docker, Local)으로 호스트 하드코딩 문제 해결. 파일 수정 없이 환경 전환 가능
- **고객사별 설정 지원**: config.yml에 사이트별 섹션을 추가하는 것만으로 새 고객사 환경을 지원. 코드 수정 불필요
- **OnceCell 캐싱**: 설정 파일을 한 번만 읽고 `OnceCell`에 저장. 런타임 성능 영향 없음

이 설정 시스템은 Spring의 `application-{profile}.yml`이나 Node.js의 `config` 패키지와 비슷한 패턴이다. Rust 생태계에는 `config` 크레이트가 있지만, YAML + 환경변수 확장 + site/env 2차원 매트릭스 오버라이드까지 지원하는 기성 크레이트는 없어서 직접 구현했다. 결과적으로 `serde_yaml` + `once_cell` + `dotenvy` 세 크레이트만으로 충분했다.
