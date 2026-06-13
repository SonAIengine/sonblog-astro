---
title: 'Rust로 API Gateway 만들기: JWT 검증 + CORS + 프록시'
description: Axum 기반 Rust API Gateway의 JWT 인증, CORS 설정, 리버스 프록시, WebSocket 프록시 구현
  과정
pubDatetime: 2025-10-28
tags:
- Rust
- Axum
- API Gateway
- JWT
- CORS
- Reverse Proxy
- WebSocket
- Full Stack
---


XGEN 2.0 플랫폼의 백엔드 서비스가 7개 이상으로 늘어나면서, 프론트엔드가 각 서비스에 직접 통신하는 구조는 더 이상 유지하기 어려워졌다. 인증 로직이 서비스마다 중복되고, CORS 설정이 제각각이었으며, 새 서비스를 추가할 때마다 프론트엔드 설정을 건드려야 했다. API Gateway가 필요했다.

기존에 Node.js나 Python으로 게이트웨이를 운영하는 방법도 있었지만, 이번에는 Rust를 선택했다. 단순한 프록시가 아니라 JWT 검증, 멀티 세션 관리, WebSocket 프록시까지 직접 구현하면서 약 4개월간 운영해 온 과정을 정리한다.

## 왜 Rust인가

API Gateway는 모든 요청이 거쳐가는 단일 지점이다. 지연 시간이 곧 전체 시스템의 지연 시간에 더해진다. Rust를 선택한 이유는 명확했다.

첫째, 성능이다. Axum은 tokio 런타임 위에서 동작하는 비동기 웹 프레임워크로, 가비지 컬렉션 없이 제로 코스트 추상화를 제공한다. 프록시 서버 특성상 대부분의 시간이 네트워크 I/O 대기인데, tokio의 비동기 모델이 이 상황에 최적이다.

둘째, 타입 안전성이다. 게이트웨이에서 헤더 파싱, JWT 클레임 추출, 서비스 라우팅 등 문자열 조작이 많은데, Rust의 타입 시스템이 런타임 에러를 컴파일 타임에 잡아준다. 실제로 `HeaderValue`에 한글 사용자명을 넣으려다 컴파일 에러가 나서 URL 인코딩 처리를 미리 추가할 수 있었다.

셋째, 바이너리 하나로 배포가 끝난다. Node.js처럼 `node_modules`를 관리할 필요도, Python처럼 가상환경을 설정할 필요도 없다. Docker 이미지 크기도 수십 MB 수준으로 유지된다.

## 전체 아키텍처

```mermaid
flowchart LR
    Client[Frontend / Client] --> GW[API Gateway<br/>Axum + Rust]

    GW --> Auth[인증 모듈<br/>JWT + Redis]
    GW --> Proxy[프록시 모듈<br/>reqwest + Streaming]
    GW --> WS[WebSocket 프록시<br/>tokio-tungstenite]

    Auth --> PG[(PostgreSQL<br/>사용자 DB)]
    Auth --> Redis[(Redis<br/>세션 저장소)]

    Proxy --> Core[xgen-core<br/>:8000]
    Proxy --> Docs[xgen-documents<br/>:8000]
    Proxy --> WF[xgen-workflow<br/>:8000]
    Proxy --> Model[xgen-model<br/>:8000]
    Proxy --> Audio[xgen-audio-svc<br/>:8000]
    Proxy --> ML[xgen-ml-svc<br/>:8000]
    Proxy --> HF[xgen-huggingface-svc<br/>:8000]
    Proxy --> DM[xgen-data-manager-svc<br/>:8000]

    WS --> Core
    WS --> WF
```

게이트웨이는 크게 세 가지 역할을 한다.

1. 인증 모듈: 로그인/로그아웃, JWT 토큰 발급/검증, Redis 기반 세션 관리
2. 프록시 모듈: 서비스 라우팅, 헤더 전파, 스트리밍 응답 전달
3. WebSocket 프록시: 양방향 실시간 통신 중계

프론트엔드는 게이트웨이 하나만 바라본다. `/api/workflow/*`로 요청하면 게이트웨이가 알아서 `xgen-workflow:8000`으로 전달하고, 인증 정보를 `x-user-id`, `x-user-name`, `x-user-admin` 헤더로 변환해서 업스트림에 주입한다. 업스트림 서비스는 자체적으로 JWT 검증을 할 필요가 없다.

## 프로젝트 구조와 의존성

```
xgen-backend-gateway/
  Cargo.toml
  ContainerInfo.toml
  config/
    config.yml          # site/env별 DB, Redis, 외부 서비스 설정
    services.yaml       # 서비스 라우팅 맵 (K8s 환경)
    services.docker.yaml
    services.local.yaml
  src/
    main.rs             # 엔트리포인트, 라우터 구성
    config.rs           # 설정 로드, 서비스 URL 해석
    middleware/
      security.rs       # JWT 생성/검증, 헤더 주입
    routes/
      security.rs       # 로그인/로그아웃/토큰 검증 API
      proxy.rs          # 리버스 프록시
      ws_proxy.rs       # WebSocket 프록시
      health.rs         # 헬스 체크
      server_status.rs  # 서비스 상태 대시보드
```

Cargo.toml의 핵심 의존성은 다음과 같다.

```toml
[dependencies]
axum = { version = "0.7", features = ["macros", "http1", "http2", "json", "tokio", "ws"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.5", features = ["trace", "cors", "request-id"] }
reqwest = { version = "0.12", features = ["json", "stream", "http2", "gzip", "brotli", "deflate"] }
jsonwebtoken = "9"
redis = { version = "0.25", features = ["tokio-comp"] }
sqlx = { version = "0.7", features = ["runtime-tokio", "postgres", "chrono"] }
sha2 = "0.10"
tokio-tungstenite = "0.21"
utoipa = { version = "4", features = ["axum_extras", "chrono"] }
utoipa-swagger-ui = { version = "6", features = ["axum"] }

[profile.release]
codegen-units = 1
lto = true
opt-level = "z"
```

각 크레이트의 선택 이유가 있다.

- `axum 0.7`: Hyper 1.0 기반으로 WebSocket 업그레이드를 네이티브로 지원한다. `ws` 피처를 활성화하면 `WebSocketUpgrade` 추출자를 사용할 수 있다.
- `reqwest 0.12`: 업스트림으로의 HTTP 요청에 사용한다. `stream` 피처로 스트리밍 응답을, `gzip`/`brotli`/`deflate`로 압축 응답을 처리한다.
- `jsonwebtoken 9`: HS256 기반 JWT 생성과 검증을 담당한다. 만료 시간 검증을 비활성화하는 옵션도 지원해서 refresh 토큰 플로우에 활용했다.
- `sha2`: 토큰을 Redis 키로 사용할 때 SHA256 해시를 적용한다. 토큰 원문을 키로 쓰면 Redis 메모리 낭비가 심하다.
- `tokio-tungstenite`: 업스트림 WebSocket 서버에 연결하는 클라이언트 역할을 한다.

릴리스 빌드에서는 `lto = true`와 `opt-level = "z"`로 바이너리 크기를 최소화했다.

## 서비스 라우팅 설정

서비스 라우팅은 YAML 파일로 관리한다. 하드코딩 대신 설정 파일을 사용한 이유는, K8s/Docker/로컬 등 환경마다 호스트 주소가 다르기 때문이다.

```yaml
# config/services.yaml
base_path: /api

services:
  xgen-core:
    host: http://xgen-core:8000
    modules:
      - admin
      - auth
      - config
      - llm
      - session-station

  retrieval-service:
    host: http://xgen-documents:8000
    modules:
      - retrieval
      - documents
      - folder
      - embedding
      - data-processor
      - storage

  workflow-service:
    host: http://xgen-workflow:8000
    modules:
      - workflow
      - interaction
      - editor
      - node
      - tools
      - prompt
      - mcp

external:
  minio: http://minio:9000
  qdrant: http://qdrant:6333
```

`/api/workflow/list` 요청이 들어오면, 게이트웨이는 `workflow` 모듈이 `workflow-service`에 속해있다는 것을 확인하고, `http://xgen-workflow:8000/api/workflow/list`로 전달한다.

이 라우팅 해석 로직은 `config.rs`의 `get_service_base_url` 함수에서 처리한다.

```rust
pub fn get_service_base_url(module: &str) -> Option<String> {
    // 1) 환경변수 오버라이드: SERVICE_{MODULE}_URL
    if let Some(from_env) = env_override(module) {
        return Some(from_env);
    }

    // 2) 설정 파일에서 모듈이 속한 서비스 찾기
    if let Some(url) = find_module_url(module) {
        return Some(url);
    }

    // 3) 외부 서비스 확인 (minio, qdrant 등)
    if let Some(url) = find_external_service(module) {
        return Some(url);
    }

    None
}
```

3단계 폴백 구조다. 환경변수 `SERVICE_WORKFLOW_URL`이 설정되어 있으면 최우선으로 사용하고, 없으면 YAML 파일에서 찾고, 거기에도 없으면 외부 서비스 목록을 확인한다. K8s 배포 시 특정 서비스만 다른 주소로 라우팅해야 할 때 환경변수로 간단하게 오버라이드할 수 있다.

### 환경별 설정 병합

`config.yml`은 site/env별로 DB, Redis, 외부 서비스 URL을 오버라이드한다.

```yaml
# config/config.yml
default:
  DOCS_PAGE: true
  DATABASE_URL: postgresql://ailab:ailab123@postgresql.xgen-system.svc.cluster.local:5432/plateerag
  REDIS_URL: redis://:redis_secure_password123!@redis.xgen-system.svc.cluster.local:6379

docker:
  development:
    DATABASE_URL: postgresql://ailab:dev_password123@postgresql:5432/plateerag_dev
    REDIS_URL: redis://:dev_redis123@redis:6379/0

xgen-x2bee-com:
  production:
    DOCS_PAGE: false
    DATABASE_URL: postgresql://...
```

`APP_SITE`과 `APP_ENV` 환경변수 조합으로 어떤 설정을 적용할지 결정한다. `default` 설정을 기본으로 깔고, site.env에 정의된 값만 오버라이드하는 구조다. 같은 바이너리를 여러 환경에서 환경변수만 바꿔 배포할 수 있다.

## JWT 인증 시스템

### access / refresh 토큰 분리

인증은 access token과 refresh token 이중 구조로 설계했다.

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,        // 사용자 ID (숫자 문자열)
    pub username: String,   // 사용자명
    pub is_admin: bool,     // 관리자 여부
    pub exp: usize,         // 만료 시각 (UNIX timestamp)
    #[serde(default)]
    pub r#type: Option<String>,  // "access" or "refresh"
}
```

access token에는 사용자명과 관리자 여부를 포함하고, refresh token에는 `sub`(사용자 ID)만 담는다. refresh token은 access token 재발급 용도로만 사용되므로, 최소한의 정보만 포함시켰다.

```rust
pub fn create_access_token(keys: &JwtKeys, sub: &str, username: &str,
                           is_admin: bool, minutes: i64) -> anyhow::Result<String> {
    let exp = (Utc::now() + Duration::minutes(minutes)).timestamp() as usize;
    let claims = Claims {
        sub: sub.into(),
        username: username.into(),
        is_admin,
        exp,
        r#type: Some("access".into()),
    };
    let token = encode(&Header::default(), &claims, &keys.encoding())?;
    Ok(token)
}

pub fn create_refresh_token(keys: &JwtKeys, sub: &str, days: i64) -> anyhow::Result<String> {
    let exp = (Utc::now() + Duration::days(days)).timestamp() as usize;
    let claims = Claims {
        sub: sub.into(),
        username: "".into(),  // refresh token에는 username 미포함
        is_admin: false,
        exp,
        r#type: Some("refresh".into()),
    };
    let token = encode(&Header::default(), &claims, &keys.encoding())?;
    Ok(token)
}
```

access token 기본 만료 시간은 1440분(24시간), refresh token은 7일이다. 환경변수 `ACCESS_TOKEN_EXPIRE_MIN`과 `REFRESH_TOKEN_EXPIRE_DAYS`로 조정 가능하다.

### 로그인 플로우

로그인 과정은 DB 조회, 비밀번호 비교, 토큰 발급, Redis 세션 저장의 4단계로 구성된다.

```rust
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> (StatusCode, Json<LoginResponse>) {
    // 1. DB에서 사용자 조회
    let user = match find_user_by_email(&state.db_pool, &payload.email).await {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::UNAUTHORIZED, /* ... */),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, /* ... */),
    };

    // 2. 비활성 사용자 차단
    if !user.is_active {
        return (StatusCode::UNAUTHORIZED, Json(LoginResponse {
            message: "계정이 비활성화 상태입니다. 관리자 승인이 필요합니다.".into(),
            ..
        }));
    }

    // 3. 비밀번호 비교
    if user.password_hash != payload.password {
        return (StatusCode::UNAUTHORIZED, /* ... */);
    }

    // 4. access + refresh 토큰 발급
    let keys = JwtKeys::from_env();
    let access = create_access_token(&keys, &user_id, &username, is_admin, 1440)?;
    let refresh = create_refresh_token(&keys, &user_id, 7)?;

    // 5. Redis 세션 저장 (SHA256 해시 기반)
    let access_hash = hash_token(&access);
    let session_key = format!("session:{}:{}", &user_id, &access_hash);
    con.set_ex(session_key, &access, token_ttl_secs()).await?;

    // 6. 사용자 권한 정보도 Redis에 캐싱
    let (user_sections, admin_sections) = resolve_user_sections_with_groups(&state.db_pool, &user).await;
    // ...
}
```

# 커밋: feat: Add password hashing and multi-session support in authentication flow
# 날짜: 2025-11-12 16:56

비활성 사용자 로그인 차단은 2026년 1월에 추가했다. 회원가입 후 관리자 승인이 필요한 워크플로우를 지원하기 위해서다.

# 커밋: [FEATURE] Add is_active field to User struct and implement login check for inactive users
# 날짜: 2026-01-13 16:33

### Redis 세션 관리와 멀티 세션

세션을 Redis에 저장하는 이유는 두 가지다. 첫째, 서버가 여러 대일 때 세션을 공유할 수 있다. 둘째, 토큰을 무효화(로그아웃)할 수 있다. JWT 자체는 stateless하지만, Redis에 저장된 세션이 없으면 유효하지 않은 토큰으로 취급한다.

Redis 키 구조는 다음과 같다.

```
session:{user_id}:{token_hash}     → access token 원문 (TTL: 24시간)
refresh:{user_id}:{refresh_hash}   → refresh token 원문 (TTL: 7일)
user_info:{user_id}:{token_hash}   → 사용자 정보 JSON (권한, 섹션 등)
user_sessions:{user_id}            → Set(active token hashes) (TTL: 24시간)
```

토큰 해시를 키에 포함시킨 이유는 멀티 세션 지원 때문이다. 같은 사용자가 데스크톱과 모바일에서 동시에 로그인하면, 각각 다른 토큰을 갖고 있고, 각 세션이 독립적으로 관리된다. 로그아웃하면 해당 세션만 삭제된다.

```rust
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}
```

토큰 원문을 Redis 키로 쓰면 수백 바이트의 JWT가 키가 되어 메모리 낭비가 심하다. SHA256 해시로 변환하면 키 길이가 64자로 고정된다.

세션 수 제한도 구현했다. 한 사용자가 무한히 세션을 만들 수 없도록 기본 5개로 제한하고, 초과 시 가장 오래된 세션(TTL이 짧은 것)부터 제거한다.

```rust
let max_sessions = std::env::var("MAX_SESSIONS_PER_USER")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(5usize);

if existing_hashes.len() >= max_sessions {
    // TTL 기준으로 정렬 (오래된 것부터)
    sessions_with_ttl.sort_by_key(|&(_, ttl)| ttl);
    // 초과분만큼 삭제 (새 세션 1개 추가할 공간 확보)
    let sessions_to_remove = sessions_with_ttl.len() - (max_sessions - 1);
    for (hash, _) in sessions_with_ttl.iter().take(sessions_to_remove) {
        let old_session_key = format!("session:{}:{}", &user_id, hash);
        con.del(&old_session_key).await.unwrap_or(());
        con.srem(&user_sessions_key, hash).await.unwrap_or(());
    }
}
```

### Refresh Token 자동 갱신

access token이 만료되었을 때, 프론트엔드가 `validate-token` API를 호출하면서 refresh token을 함께 보내면, 게이트웨이가 자동으로 새 access token을 발급한다.

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as Gateway
    participant R as Redis
    participant DB as PostgreSQL

    C->>GW: POST /auth/validate-token<br/>{token, refresh_token}
    GW->>GW: JWT 디코딩 (만료됨)
    GW->>GW: 만료 검증 비활성화하고 재디코딩<br/>(sub 추출)
    GW->>GW: refresh_token JWT 검증
    GW->>R: refresh:{user_id}:{hash} 확인
    R-->>GW: 저장된 refresh token
    GW->>GW: 토큰 일치 확인
    GW->>DB: user_id로 사용자 조회
    DB-->>GW: 사용자 정보
    GW->>GW: 새 access token 발급
    GW->>R: 새 세션 저장
    GW-->>C: {valid: true, new_access_token: "..."}
```

핵심 로직은 만료된 access token에서 `sub`(사용자 ID)를 추출하는 부분이다. `jsonwebtoken` 크레이트의 `Validation` 구조체에서 `validate_exp = false`로 설정하면 만료 검증을 건너뛸 수 있다.

```rust
// 만료된 토큰에서 sub 추출 (만료 검증 비활성화)
let mut noexp_validation = Validation::new(Algorithm::HS256);
noexp_validation.validate_exp = false;
let access_data = decode::<Claims>(token, &keys.decoding(), &noexp_validation)?;
let access_claims = access_data.claims;

// refresh token의 sub와 access token의 sub가 일치하는지 확인
if refresh_claims.sub != access_claims.sub {
    return Err("Refresh token subject does not match");
}
```

# 커밋: feat: Enhance token validation to support refresh token for access token rotation
# 날짜: 2025-11-21 16:20

이 플로우 덕분에 프론트엔드는 access token 만료를 신경 쓰지 않아도 된다. `validate-token` 호출 결과에 `new_access_token`이 있으면 그걸 저장해서 쓰면 된다.

### 그룹 기반 권한 관리

사용자 권한은 DB의 `available_user_sections`, `available_admin_sections` 필드에 저장되는데, 그룹에 소속된 사용자는 그룹의 권한도 자동으로 상속받는다. `superuser` 타입 사용자는 모든 권한을 갖는다.

```rust
async fn resolve_user_sections_with_groups(pool: &sqlx::PgPool, user: &User) -> (String, String) {
    // superuser는 전체 권한
    if user.user_type.as_deref() == Some("superuser") {
        return get_all_sections();
    }

    // 기본 사용자 권한
    let mut user_sections: Vec<String> = user.available_user_sections
        .as_ref()
        .map(|arr| arr.iter().map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    // 소속 그룹의 권한 추가
    if let Some(groups_arr) = &user.groups {
        for group_name in groups_arr.iter().filter(|g| !g.ends_with("__admin__")) {
            if let Ok(Some(group_meta)) = find_group_by_name(pool, group_name).await {
                if let Some(sections) = &group_meta.available_sections {
                    user_sections.extend(sections.iter().map(|s| s.to_string()));
                }
            }
        }
    }

    // 중복 제거
    user_sections.sort();
    user_sections.dedup();

    (user_sections.join(","), admin_sections)
}
```

`groups` 필드가 PostgreSQL TEXT[] 배열 타입이라 `Vec<String>`으로 직접 매핑된다. 초기에는 콤마로 구분된 문자열이었는데, 배열 타입으로 전환하면서 코드가 훨씬 깔끔해졌다.

# 커밋: feat: Update groups field in User struct to support array type for enhanced flexibility
# 날짜: 2025-11-14 11:36

## CORS 설정

CORS 설정은 `tower-http`의 `CorsLayer`를 사용했다. 모든 오리진을 허용하는 이유는, XGEN 플랫폼이 여러 도메인(`xgen.x2bee.com`, `xgen.infoedu.co.kr` 등)에서 접근하기 때문이다.

```rust
let cors = CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([
        Method::GET, Method::POST, Method::PUT,
        Method::PATCH, Method::DELETE, Method::OPTIONS,
    ])
    .allow_headers(Any);
```

`Any`로 설정한 이유가 또 있다. 프론트엔드에서 커스텀 헤더(`x-user-id`, `authorization` 등)를 자유롭게 보내야 하는데, 허용 헤더를 일일이 나열하면 새 헤더가 추가될 때마다 게이트웨이를 수정해야 한다. 보안은 JWT 검증으로 충분히 담보하고 있으므로, CORS는 관대하게 설정했다.

CORS 레이어는 라우터의 가장 바깥에 적용한다. `layer(cors)`가 마지막에 호출되므로 모든 응답에 CORS 헤더가 추가된다.

```rust
let app = app
    .nest("/api", api)
    .fallback(fallback_404)
    .with_state(state)
    .layer(request_id_layer)
    .layer(trace_layer)
    .layer(cors);
```

## 리버스 프록시

프록시 모듈은 게이트웨이의 핵심이다. 모든 업스트림 요청이 이 함수를 거친다.

### 라우팅과 프록시 함수

```rust
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024 * 1024; // 2GB

pub async fn proxy_stub(
    State(state): State<AppState>,
    Path((service, tail)): Path<(String, String)>,
    ws: Option<WebSocketUpgrade>,
    req: Request<Body>,
) -> Response {
    // 1. 서비스 URL 조회
    let base = match get_service_base_url(&service) {
        Some(u) => u,
        None => return json_error(StatusCode::BAD_GATEWAY, "Unknown service"),
    };

    // 2. JWT에서 사용자 정보 추출 → 헤더 주입
    let mut tmp_headers = HeaderMap::new();
    inject_user_headers_from_auth(req.headers(), &mut tmp_headers, &state.redis_client).await;

    // 3. 전체 URL 구성 (쿼리 파라미터 포함)
    let upstream = format!("{}/{}{}", base.trim_end_matches('/'),
                           tail.trim_start_matches('/'), query);

    // 4. WebSocket 업그레이드 감지 → ws_proxy로 분기
    if let Some(ws) = ws {
        return ws.on_upgrade(move |socket| {
            ws_proxy::proxy_websocket(socket, upstream, ws_headers)
        });
    }

    // 5. reqwest로 업스트림에 전달
    let resp = client.request(method, &upstream)
        .headers(propagated_headers)
        .body(body_bytes)
        .send()
        .await?;

    // 6. 스트리밍으로 응답 전달
    let stream = resp.bytes_stream()
        .map(|chunk| chunk.map_err(|e| io::Error::new(io::ErrorKind::Other, e)));
    Response::new(Body::from_stream(stream))
}
```

`proxy_stub`은 Axum의 `any` 핸들러에 등록되어 GET/POST/PUT/DELETE 등 모든 HTTP 메서드를 수용한다. 라우트 패턴은 두 가지다.

```rust
.route("/proxy/:service/*tail", any(proxy::proxy_stub))
.route("/:service/*tail", any(proxy::proxy_stub))
```

`/api/proxy/workflow/list`와 `/api/workflow/list` 모두 동일하게 처리된다. `/proxy/` 접두사가 있는 패턴은 명시적으로 프록시 요청임을 나타내고, 없는 패턴은 편의상 제공한다.

### 헤더 전파

업스트림으로 요청을 보낼 때 모든 헤더를 무조건 전달하면 안 된다. Hop-by-hop 헤더(`Connection`, `Keep-Alive`, `Transfer-Encoding` 등)는 프록시 경계에서 제거해야 한다.

```rust
fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(name.as_str().to_ascii_lowercase().as_str(),
        "connection" | "keep-alive" | "proxy-authenticate" |
        "proxy-authorization" | "te" | "trailers" |
        "transfer-encoding" | "upgrade")
}

fn propagate_headers_to_upstream(
    incoming: &HeaderMap,
    mut builder: reqwest::RequestBuilder,
    user_headers: &HeaderMap,
) -> reqwest::RequestBuilder {
    // 기본 헤더 전파 (Hop-by-hop 제외, Host 제외)
    for (name, value) in incoming.iter() {
        if name.as_str().eq_ignore_ascii_case("host") || is_hop_by_hop(name) {
            continue;
        }
        builder = builder.header(name, value.to_str().unwrap_or(""));
    }

    // X-Forwarded-* 헤더 추가
    builder = builder.header("x-forwarded-host", host);
    builder = builder.header("x-forwarded-proto", detect_forwarded_proto(incoming));
    builder = builder.header("x-forwarded-origin", origin);

    // 사용자 식별 헤더 주입
    for (k, v) in user_headers.iter() {
        builder = builder.header(k, v.to_str().unwrap_or(""));
    }

    builder
}
```

# 커밋: feat: Enhance proxy header propagation with protocol detection
# 날짜: 2025-11-07 17:26

프로토콜 감지는 여러 소스를 순회한다. `X-Forwarded-Proto`, `Forwarded` 헤더의 `proto` 파라미터, `Cloudfront-Forwarded-Proto`, `X-Forwarded-SSL`, `Front-End-Https` 등을 확인한다. 이렇게 다양한 헤더를 확인하는 이유는, 리버스 프록시(Nginx, CloudFront 등)마다 사용하는 헤더가 다르기 때문이다.

### 사용자 헤더 주입

프록시가 업스트림에 요청을 보낼 때, JWT에서 추출한 사용자 정보를 `x-user-id`, `x-user-name`, `x-user-admin` 헤더로 주입한다.

```rust
pub fn set_user_headers(
    headers: &mut HeaderMap,
    user_id: &str,
    username: &str,
    is_admin: bool,
) -> bool {
    headers.insert("x-user-id", HeaderValue::from_str(user_id).unwrap_or_default());

    // 한글 사용자명은 URL 인코딩
    let encoded_username = urlencoding::encode(username);
    headers.insert("x-user-name", HeaderValue::from_str(&encoded_username).unwrap_or_default());
    headers.insert("x-user-admin",
        HeaderValue::from_static(if is_admin { "true" } else { "false" }));

    true
}
```

HTTP 헤더 값에는 ASCII만 허용된다. 한글 사용자명을 그대로 넣으면 `HeaderValue::from_str`이 실패한다. `urlencoding::encode`로 변환하면 `%EC%86%90%EC%84%B1%EC%A4%80` 같은 형태가 되어 헤더에 안전하게 넣을 수 있다. 업스트림 서비스에서 `urlencoding::decode`로 원래 이름을 복원한다.

### 스트리밍 응답

2GB까지의 대용량 파일 업로드/다운로드를 지원하기 위해 응답을 스트리밍으로 전달한다. 응답 전체를 메모리에 버퍼링하지 않는다.

```rust
// 성공 응답은 스트리밍으로 전달
let stream = resp
    .bytes_stream()
    .map(|chunk| chunk.map_err(|e| io::Error::new(io::ErrorKind::Other, e)));
let body = Body::from_stream(stream);
let mut resp_axum = Response::new(body);
```

에러 응답(4xx/5xx)은 바디를 수집해서 처음 2048바이트를 로그에 남긴다. 디버깅할 때 업스트림이 어떤 에러를 반환했는지 게이트웨이 로그만 보면 알 수 있다.

```rust
if status.is_client_error() || status.is_server_error() {
    let bytes = resp.bytes().await?;
    let snippet_len = std::cmp::min(bytes.len(), 2048);
    let snippet = String::from_utf8_lossy(&bytes[..snippet_len]);
    tracing::warn!(
        event = "proxy_upstream_error",
        %service, %upstream, status = status.as_u16(),
        resp_snippet = %snippet,
        "Upstream returned error status"
    );
}
```

# 커밋: feat: Increase maximum body size limit for proxy requests to 2GB
# 날짜: 2025-11-13 19:35

## WebSocket 프록시

AI 에이전트 플랫폼 특성상 실시간 스트리밍이 필수다. LLM 추론 결과를 토큰 단위로 스트리밍하거나, 워크플로우 실행 상태를 실시간으로 전달해야 한다. HTTP SSE(Server-Sent Events)도 사용하지만, 양방향 통신이 필요한 경우 WebSocket을 쓴다.

WebSocket 프록시는 2026년 2월에 추가했다. 구현 핵심은 클라이언트 WebSocket과 업스트림 WebSocket 사이에 양방향 메시지 파이프라인을 구성하는 것이다.

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as Gateway
    participant US as Upstream

    C->>GW: WebSocket Upgrade 요청
    GW->>GW: Upgrade 감지, 인증 헤더 추출
    GW->>US: WebSocket 연결 (tokio-tungstenite)
    Note over GW: 양방향 프록시 시작

    par Client to Upstream
        C->>GW: Message
        GW->>US: Message (변환)
    and Upstream to Client
        US->>GW: Message
        GW->>C: Message (변환)
    end

    Note over GW: 한쪽 종료 시 양쪽 모두 종료
```

### WebSocket 업그레이드 감지

Axum에서 WebSocket 업그레이드는 `WebSocketUpgrade` 추출자로 감지한다. `Option<WebSocketUpgrade>`로 선언하면, WebSocket 요청이 아닐 때는 `None`이 되어 일반 HTTP 프록시로 처리된다.

```rust
pub async fn proxy_stub(
    // ...
    ws: Option<WebSocketUpgrade>,
    req: Request<Body>,
) -> Response {
    // WebSocket upgrade 감지 → ws_proxy로 위임
    if let Some(ws) = ws {
        return ws.on_upgrade(move |socket| {
            ws_proxy::proxy_websocket(socket, upstream, ws_headers)
        });
    }
    // 일반 HTTP 프록시 ...
}
```

### 양방향 프록시 구현

WebSocket 프록시의 핵심은 `tokio::select!`로 두 방향의 메시지 전달을 동시에 수행하는 것이다.

```rust
pub async fn proxy_websocket(
    client_socket: WebSocket,
    upstream_url: String,
    headers: HeaderMap,
) {
    // http:// → ws://, https:// → wss:// 변환
    let ws_url = upstream_url
        .replacen("http://", "ws://", 1)
        .replacen("https://", "wss://", 1);

    // 업스트림 WebSocket 연결 (수동 핸드셰이크 헤더 설정)
    let ws_key = tungstenite::handshake::client::generate_key();
    let mut request_builder = http::Request::builder()
        .uri(&ws_url)
        .header("Host", &host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", &ws_key);

    // 인증 헤더 전달
    for (name, value) in headers.iter() {
        request_builder = request_builder.header(name.as_str(), value.to_str()?);
    }

    let (upstream_ws, _) = tokio_tungstenite::connect_async(request).await?;

    let (mut client_tx, mut client_rx) = client_socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream_ws.split();

    // 양방향 포워딩
    let client_to_upstream = async {
        while let Some(Ok(msg)) = client_rx.next().await {
            if let Some(tung_msg) = axum_to_tungstenite(msg) {
                if upstream_tx.send(tung_msg).await.is_err() { break; }
            }
        }
    };

    let upstream_to_client = async {
        while let Some(Ok(msg)) = upstream_rx.next().await {
            if let Some(axum_msg) = tungstenite_to_axum(msg) {
                if client_tx.send(axum_msg).await.is_err() { break; }
            }
        }
    };

    // 한쪽이 종료되면 양쪽 모두 종료
    tokio::select! {
        _ = client_to_upstream => {}
        _ = upstream_to_client => {}
    }
}
```

Axum의 WebSocket 메시지 타입과 `tokio-tungstenite`의 메시지 타입이 다르기 때문에 변환 함수가 필요하다. `axum_to_tungstenite`와 `tungstenite_to_axum` 함수가 Text, Binary, Ping, Pong, Close 메시지를 양방향으로 변환한다.

# 커밋: feat: Add WebSocket proxy support to gateway
# 날짜: 2026-02-11 13:06

### WebSocket 핸드셰이크 문제

처음 구현했을 때 업스트림 WebSocket 연결이 실패하는 문제가 있었다. `tokio_tungstenite::connect_async`에 `http::Request`를 직접 전달하면, tungstenite가 자동으로 WebSocket 핸드셰이크 헤더(`Connection: Upgrade`, `Sec-WebSocket-Key` 등)를 추가해 주지 않았다. URL 문자열을 전달할 때만 자동으로 추가된다.

해결책은 핸드셰이크 헤더를 수동으로 설정하는 것이었다.

```rust
let ws_key = tungstenite::handshake::client::generate_key();
let mut request_builder = http::Request::builder()
    .uri(&ws_url)
    .header("Host", &host)
    .header("Connection", "Upgrade")
    .header("Upgrade", "websocket")
    .header("Sec-WebSocket-Version", "13")
    .header("Sec-WebSocket-Key", &ws_key);
```

`Host` 헤더도 빠뜨리면 일부 업스트림에서 거부한다. URI에서 호스트 부분을 추출해서 명시적으로 넣어주었다.

# 커밋: fix: Manually set WebSocket handshake headers in proxy request
# 날짜: 2026-02-11 13:11

# 커밋: fix: Add Host header to WebSocket proxy requests
# 날짜: 2026-02-11 13:15

이 두 커밋은 같은 날 30분 간격으로 연달아 올라갔다. WebSocket 프록시를 추가하고 바로 테스트하면서 발견한 문제들을 즉시 수정한 것이다.

## 헬스 체크와 서버 상태

### 기본 헬스 체크

K8s의 liveness/readiness 프로브를 위한 엔드포인트다.

```rust
pub async fn healthz() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

pub async fn readyz() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(json!({"status": "ready"})))
}
```

`/healthz`는 루트 경로에 위치한다. `/api` 하위가 아닌 이유는, 인프라 헬스 프로브는 인증 없이 접근 가능해야 하기 때문이다.

### 서비스 상태 대시보드

운영 중 모든 마이크로서비스의 상태를 한눈에 확인하고 싶었다. `/api/server-status` 엔드포인트를 만들어, 게이트웨이가 모든 서비스의 `/health-status`를 동시에 호출하고 결과를 집계한다.

```rust
async fn collect_service_statuses(
    state: &AppState,
    config: &ServicesConfig,
) -> ServerStatusResponse {
    let mut tasks = Vec::new();

    for (service_name, service_info) in &config.services {
        let client = state.client.clone();
        let task = tokio::spawn(async move {
            let url = format!("{}/health-status", host);
            match fetch_service_health_raw(&client, &url).await {
                Ok(value) => parse_health_response(&service_name, value),
                Err(_) => vec![(service_name, default_status)],
            }
        });
        tasks.push(task);
    }

    // 모든 요청 동시 대기
    for task in tasks {
        if let Ok(services) = task.await {
            for (name, status) in services {
                result.insert(name, status);
            }
        }
    }
    result
}
```

`tokio::spawn`으로 각 서비스 체크를 병렬로 수행한다. 8개 서비스를 순차적으로 호출하면 최대 40초(각 5초 타임아웃)가 걸리지만, 병렬로 하면 5초 이내에 끝난다. PostgreSQL과 Redis도 직접 연결 체크를 한다.

이 엔드포인트는 superuser 권한이 필요하다. 시스템 내부 정보가 노출되기 때문이다.

# 커밋: feat: Add server status endpoint to retrieve health status of all services
# 날짜: 2025-12-19 16:16

### 버전 관리 (ContainerInfo.toml)

게이트웨이 자체의 버전과 Git 커밋 정보를 `/api/server-status` 응답에 포함한다. `ContainerInfo.toml`을 `include_str!`로 바이너리에 내장하고, 런타임에 Git 명령으로 최신 커밋 정보를 가져온다.

```toml
# ContainerInfo.toml
version = "1.0.3"
version_description = "superuser 인증 추가 및 자체 상태 정보 제공"
fallback_git_commit_hash = "4909b95"
fallback_git_commit_date = "2025-12-21 16:46:22 +0900"
container_name = "XGen Backend Gateway"
readme_path = "Update.md"
```

Docker 컨테이너 안에서는 Git이 없으므로 `fallback_git_commit_hash`가 사용된다. CI/CD 파이프라인에서 빌드 전에 이 값을 업데이트한다.

# 커밋: feat: Embed ContainerInfo.toml in binary and improve loading logic with environment variable support
# 날짜: 2025-12-21 16:46

## DB 연결 재시도 로직

K8s 환경에서 게이트웨이 Pod가 PostgreSQL보다 먼저 뜨는 경우가 있다. 이때 DB 연결이 실패하면 즉시 종료하는 대신, 최대 10회까지 5초 간격으로 재시도한다.

```rust
let db_pool = {
    let max_retries = 10;
    let mut retry_count = 0;
    loop {
        match PgPool::connect(&config.database_url).await {
            Ok(pool) => break pool,
            Err(e) => {
                retry_count += 1;
                if retry_count >= max_retries {
                    return Err(e.into());
                }
                tracing::warn!(
                    error = %e,
                    retry = retry_count,
                    "Database connection failed, retrying in 5 seconds..."
                );
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
};
```

Redis도 동일한 재시도 로직이 적용된다. 이 패턴 덕분에 K8s에서 서비스 시작 순서에 의존하지 않는 강건한 배포가 가능해졌다.

# 커밋: feat: Implement database connection retry logic with error handling
# 날짜: 2025-12-23 08:09

## 트러블슈팅

### 토큰 만료 기본값 문제

초기에는 access token 만료 시간이 환경변수로만 설정 가능했는데, 환경변수가 없으면 `parse()`가 실패하면서 0이 반환되어 토큰이 즉시 만료되는 문제가 있었다.

```rust
// 수정 전 (문제)
let minutes = std::env::var("ACCESS_TOKEN_EXPIRE_MIN")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(0);  // 환경변수 없으면 0분 → 즉시 만료

// 수정 후
fn token_ttl_secs() -> u64 {
    std::env::var("ACCESS_TOKEN_EXPIRE_MIN")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1440u64) * 60  // 기본 24시간
}
```

# 커밋: fix: Correctly handle token expiration defaults in security module
# 날짜: 2025-11-14 08:57

# 커밋: fix: Update access token expiration default value to 1440 minutes
# 날짜: 2025-11-14 08:28

같은 날 두 번의 수정이 있었다. 첫 번째 커밋에서 기본값을 추가했는데, 두 번째 커밋에서 적정값을 1440분(24시간)으로 확정했다.

### Redis 에러 처리

분산 환경에서 Redis 연결이 일시적으로 끊기면, 프록시 요청 자체가 실패하는 문제가 있었다. Redis를 쓸 수 없어도 JWT 검증 자체는 가능하므로, Redis 연결 실패 시 JWT claims 정보만으로 폴백하도록 개선했다.

```rust
// inject_user_headers_from_auth 함수 내부
if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
    // Redis에서 최신 사용자 정보 가져오기
    if let Ok(Some(user_info_str)) = con.get::<_, Option<String>>(&user_info_key).await {
        // Redis 정보로 헤더 설정
        set_user_headers(out_headers, &user_id, username, is_admin);
        return;
    }
}

// Redis 연결 실패 또는 데이터 없음 → JWT claims로 폴백
set_user_headers(out_headers, &c.sub, &c.username, c.is_admin);
```

# 커밋: fix: Redis 에러 처리 개선 (분산 환경 안정성 향상)
# 날짜: 2026-02-04 09:19

### Refresh Token에서 username이 비는 문제

refresh token은 의도적으로 `username`을 빈 문자열로 설정한다. 그런데 refresh token으로 새 access token을 발급할 때, refresh token의 claims에서 username을 가져오면 빈 문자열이 들어가는 버그가 있었다.

해결책은 refresh token 플로우에서 항상 DB를 조회하여 최신 username을 가져오는 것이다.

```rust
// refresh 함수 내부
// refresh token에는 username이 빈 문자열이므로 DB에서 다시 조회
let user = find_user_by_id(&state.db_pool, user_id_int).await?;

// 새 access token 생성 - DB에서 조회한 실제 username 사용
let access = create_access_token(
    &keys, &claims.sub, &user.username, user.is_admin, 1440
)?;
```

이 수정을 위해 `verify_token`에서 access token의 username이 비어 있으면 경고 로그를 남기도록 했다.

```rust
// access 토큰에서 username이 빈 경우만 경고 (refresh는 정상)
if claims.username.is_empty() && claims.r#type.as_deref() != Some("refresh") {
    tracing::warn!(
        "Access token has EMPTY username! sub: '{}'. This indicates a malformed access token.",
        claims.sub,
    );
}
```

# 커밋: refactor: Remove user_id override from proxy_stub and clarify refresh_token handling in validate_token_get
# 날짜: 2025-11-23 23:30

### 서비스 라우팅 통합

시간이 지나면서 마이크로서비스 경계가 바뀌었다. `session-station`이 처음에는 독립 서비스였다가 `xgen-core`로 통합되었고, `data-processor`와 `embedding` 모듈이 `xgen-documents`로 합쳐졌다. 이런 변경이 있을 때마다 `services.yaml`만 수정하면 게이트웨이 코드 수정 없이 라우팅이 바뀐다.

# 커밋: refactor: session-station 라우팅을 xgen-core로 통합
# 날짜: 2026-02-10 14:26

# 커밋: embedding 모듈을 xgen-documents로 통합
# 날짜: 2026-01-15 13:44

이것이 설정 파일 기반 라우팅의 장점이다. 서비스 분리나 통합이 자유롭고, 게이트웨이 재배포 없이 설정만 변경하면 된다(K8s ConfigMap 교체 후 Pod 재시작).

## Swagger UI 통합

개발 환경에서는 API 문서를 바로 확인할 수 있도록 Swagger UI를 내장했다. `utoipa` 크레이트로 각 핸들러에 OpenAPI 어노테이션을 추가하고, `utoipa-swagger-ui`로 UI를 제공한다.

```rust
#[derive(OpenApi)]
#[openapi(
    paths(
        routes::security::login,
        routes::security::validate_token,
        routes::security::refresh,
        routes::security::logout,
    ),
    components(
        schemas(LoginRequest, LoginResponse, RefreshRequest, RefreshResponse,
                ValidateResponse, LogoutRequest, LogoutResponse)
    ),
    info(
        title = "XGen Backend Gateway API",
        version = "0.1.0",
    )
)]
struct ApiDoc;

// 조건부 활성화 (config.yml의 DOCS_PAGE 설정)
if config.docs_page {
    app = app.merge(SwaggerUi::new("/docs")
        .url("/api-docs/openapi.json", ApiDoc::openapi()));
}
```

production 환경에서는 `DOCS_PAGE: false`로 설정해서 Swagger UI를 비활성화한다. config.yml의 site/env별 설정이 여기서도 활용된다.

## 구조적 로깅

운영 환경에서는 JSON 포맷으로 구조적 로깅을 한다. `tracing_subscriber`의 `json` 레이어를 사용한다.

```rust
fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(
            "info,tower_http=warn,\
             xgen_backend_gateway::middleware::security=warn,\
             xgen_backend_gateway::routes::security=warn"
        ));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json().with_target(false))
        .init();
}
```

보안 모듈의 로그 레벨을 `warn`으로 낮춘 이유는, 모든 프록시 요청마다 JWT 검증 로그가 쏟아지면 로그 볼륨이 급증하기 때문이다. 문제가 있을 때만 로그가 남도록 했다. 디버깅이 필요하면 `RUST_LOG=debug`로 환경변수를 변경하면 된다.

프록시 요청마다 request_id, service, upstream URL, method, status, duration 등을 구조적으로 기록한다.

```rust
tracing::debug!(
    event = "proxy_upstream_ok",
    %service,
    %upstream,
    method = %method_str,
    status = resp_axum.status().as_u16(),
    request_id = %request_id,
    duration_ms = start.elapsed().as_millis() as u128,
    "Upstream request successful"
);
```

## 결과

4개월간 운영하면서 다음과 같은 결과를 얻었다.

- 단일 진입점: 프론트엔드는 게이트웨이 하나만 알면 된다. 8개 이상의 백엔드 서비스에 대한 주소, 포트, 프로토콜을 신경 쓸 필요가 없다.
- 인증 일원화: 각 마이크로서비스에서 JWT 검증 로직을 제거했다. `x-user-id` 헤더만 확인하면 된다.
- 서비스 유연성: 서비스 분리/통합 시 `services.yaml` 변경만으로 대응한다. session-station 독립 서비스화 후 xgen-core 통합까지, 코드 변경 없이 설정만 바꿨다.
- 멀티 세션: 같은 사용자가 여러 디바이스에서 동시 로그인하고 개별 로그아웃이 가능하다. 세션 수 제한으로 무한 세션 생성도 방지한다.
- WebSocket 프록시: 실시간 AI 추론 스트리밍을 게이트웨이를 거쳐 안정적으로 전달한다.

Rust로 게이트웨이를 만드는 것은 초기 개발 비용이 크다. 같은 기능을 Express.js나 FastAPI로 만들면 절반의 코드로 끝난다. 하지만 컴파일 타임 타입 체크, 제로 코스트 추상화, 단일 바이너리 배포의 장점은 운영이 장기화될수록 빛을 발한다. 특히 헤더 파싱이나 토큰 검증처럼 문자열 조작이 많은 코드에서 Rust의 타입 시스템이 잡아주는 버그가 적지 않았다.
