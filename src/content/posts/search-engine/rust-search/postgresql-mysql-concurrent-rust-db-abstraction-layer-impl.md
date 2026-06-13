---
title: PostgreSQL과 MySQL 동시 지원하는 Rust DB 추상화 레이어 구현
description: 커머스 검색 엔진에서 고객사별로 다른 DB를 사용하는 문제를 Rust의 트레잇 기반 추상화로 해결한 과정. 동적 디스패치,
  스트리밍 쿼리, 커넥션 풀 캐싱까지.
pubDatetime: 2025-06-01
tags:
- Rust
- PostgreSQL
- MySQL
- DB추상화
- 트레잇
- 동적디스패치
- 검색엔진
- 커넥션풀
- sqlx
- 백엔드
- Search Engine
series: Rust 커머스 검색 엔진
seriesOrder: 3
---

# PostgreSQL과 MySQL 동시 지원하는 Rust DB 추상화 레이어 구현

## 개요

Rust 검색 엔진을 여러 커머스 고객사에 적용하면서 예상치 못한 문제에 직면했다. 고객사마다 사용하는 데이터베이스가 달랐다. 대부분은 PostgreSQL을 사용하지만, 일부 레거시 시스템을 운영하는 고객사는 MySQL에서 상품 데이터를 관리하고 있었다. 검색 엔진의 인덱싱 파이프라인은 DB에서 상품 데이터를 읽어 OpenSearch에 색인하는 구조이므로, 두 데이터베이스를 모두 지원해야 했다.

NestJS 버전에서는 TypeORM으로 이 문제를 처리했다. TypeORM은 여러 DB를 지원하지만, 검색 인덱싱에 필요한 복잡한 네이티브 쿼리를 실행할 때는 결국 DB별로 다른 SQL을 작성해야 했고, 런타임에서야 쿼리 호환성 문제를 발견하는 경우가 빈번했다.

Rust에서는 트레잇(trait) 시스템을 활용해 컴파일 타임에 DB 추상화의 계약을 강제하면서도, 각 DB의 네이티브 기능을 활용할 수 있는 구조를 설계했다. 2025년 6월의 리팩토링 커밋(`Refactor database handling to support MySQL and PostgreSQL`, `Implement MySQL support and refactor database handling`)에서 이 작업을 수행했다.

## 문제 분석

커머스 검색 인덱싱에서 DB 접근 패턴은 크게 세 가지다.

**대량 데이터 페치**: 수십만 건의 상품 데이터를 한 번에 읽어와야 한다. 전체 인덱싱(full indexing) 시 사용된다.

**증분 데이터 페치**: 마지막 인덱싱 이후 변경된 데이터만 읽어온다. 변경 시간(SYS_MOD_DTM) 기반으로 필터링한다.

**커넥션 헬스 체크**: 인덱싱 시작 전 DB 연결 상태를 확인한다. 연결이 끊어진 상태에서 인덱싱을 시작하면 수십 분의 시간이 낭비될 수 있다.

이 세 패턴을 PostgreSQL과 MySQL에서 동일하게 지원해야 하되, 각 DB의 특성(PostgreSQL의 COPY, MySQL의 서버사이드 커서 등)을 활용할 수 있어야 한다.

## DatabaseClient 트레잇 설계

추상화의 핵심은 `DatabaseClient` 트레잇이다.

```rust
#[async_trait]
pub trait DatabaseClient: Send + Sync {
    /// 일반 쿼리 실행 - 전체 결과를 메모리에 로드
    async fn query_rows(&self, sql: &str) -> Result<Vec<DatabaseRow>, Box<dyn Error>>;
    
    /// 연결 상태 확인
    async fn check_connectivity(&self) -> Result<(), Box<dyn Error>>;
    
    /// 스트리밍 쿼리 - 한 행씩 처리
    async fn stream_query(
        &self,
        sql: &str,
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<DatabaseRow, Box<dyn Error + Send + Sync>>> + Send>>,
        Box<dyn Error>,
    >;

    /// 청크 기반 스트리밍 - 트랜잭션 분할
    async fn stream_query_chunked(
        &self,
        sql: &str,
        chunk_size: usize,
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<DatabaseRow, Box<dyn Error + Send + Sync>>> + Send>>,
        Box<dyn Error>,
    >;
}
```

`Send + Sync` 바운드는 필수다. 인덱싱 서비스에서 `DatabaseClient`를 tokio 태스크 간에 공유해야 하므로, 스레드 간 안전한 전송이 보장되어야 한다. `async_trait` 크레이트를 사용해 트레잇에 비동기 메서드를 정의했다.

스트리밍 쿼리의 반환 타입이 복잡해 보이지만, 풀어서 설명하면 이렇다.

```mermaid
flowchart LR
    A[stream_query] --> B[Pin]
    B --> C[Box]
    C --> D["dyn Stream"]
    D --> E["Item = Result"]
    E --> F[DatabaseRow]
    E --> G[Error]
```

- `Pin<Box<...>>`: 스트림은 자기 참조적(self-referential) 구조를 가질 수 있으므로 Pin으로 고정한다.
- `dyn Stream`: 구체적인 스트림 타입을 숨긴다. PostgreSQL과 MySQL이 서로 다른 스트림 타입을 반환하므로 동적 디스패치가 필요하다.
- `Send`: 스트림이 다른 스레드로 전달될 수 있어야 한다.

이 타입 시그니처는 Rust의 비동기 트레잇 설계에서 가장 까다로운 부분 중 하나다. 처음에는 제네릭으로 구현하려 했으나, `DatabaseClient`를 `Box<dyn DatabaseClient>`로 사용해야 하는 상황에서는 동적 디스패치가 불가피했다.

## DatabaseRow 열거형

PostgreSQL 행과 MySQL 행은 전혀 다른 타입이다. 이를 통합하기 위해 열거형을 사용했다.

```rust
#[derive(Debug)]
pub enum DatabaseRow {
    PostgreSQL(PgRow),
    MySQL(MysqlRow),
}

impl DatabaseRow {
    pub fn to_json(&self, column_map: &HashMap<String, String>) -> HashMap<String, Value> {
        match self {
            DatabaseRow::PostgreSQL(pg_row) => {
                row_to_json(pg_row, column_map)
            }
            DatabaseRow::MySQL(mysql_row) => {
                mysql_row_to_json(mysql_row, column_map)
            }
        }
    }
    
    pub fn get_id(&self) -> Result<String, Box<dyn Error>> {
        match self {
            DatabaseRow::PostgreSQL(pg_row) => {
                Ok(pg_row.try_get::<_, String>("id")?)
            }
            DatabaseRow::MySQL(mysql_row) => {
                // MySQL은 컬럼 인덱스 기반으로 접근
                let columns = mysql_row.columns();
                for (i, column) in columns.iter().enumerate() {
                    if column.name_str().to_lowercase() == "id" {
                        if let Some(value) = mysql_row.as_ref(i) {
                            match value {
                                MysqlValue::Bytes(bytes) => {
                                    return Ok(String::from_utf8(bytes.clone())?);
                                }
                                MysqlValue::Int(i) => return Ok(i.to_string()),
                                MysqlValue::UInt(u) => return Ok(u.to_string()),
                                _ => return Err("Unsupported ID type".into()),
                            }
                        }
                    }
                }
                Err("ID column not found".into())
            }
        }
    }
}
```

여기서 PostgreSQL과 MySQL의 타입 시스템 차이가 드러난다. PostgreSQL의 `tokio-postgres`는 타입 안전한 `try_get::<_, T>(column_name)` 인터페이스를 제공하지만, MySQL의 `mysql_async`는 인덱스 기반 접근이 기본이고 값 타입이 `MysqlValue` 열거형으로 래핑된다. `get_id` 메서드에서 MySQL 측 코드가 더 복잡한 이유가 바로 이것이다.

`to_json` 메서드에서 `column_map`을 인자로 받는 것은 DB 컬럼명과 OpenSearch 필드명의 매핑 때문이다. DB에서는 `GOODS_NM`이지만 OpenSearch에서는 `goodsNm`을 사용한다. 이 매핑 정보는 JSON 파일(`columns_map/goods_map.json`)로 관리한다.

## PostgreSQL 구현

PostgreSQL 구현체는 `tokio-postgres`를 사용한다.

```rust
pub struct PostgreSQLDatabase {
    client: PostgresClient,
}

#[async_trait]
impl DatabaseClient for PostgreSQLDatabase {
    async fn query_rows(&self, sql: &str) -> Result<Vec<DatabaseRow>, Box<dyn Error>> {
        let rows = self.client
            .execute_query(sql, &[], |row| row.clone())
            .await?;
        Ok(rows.into_iter().map(DatabaseRow::PostgreSQL).collect())
    }

    async fn check_connectivity(&self) -> Result<(), Box<dyn Error>> {
        self.client.check_connectivity().await
    }

    async fn stream_query(&self, sql: &str) -> Result<...> {
        let stream = self.client.stream_query(sql).await?;
        let mapped_stream = stream.map(|row_result| {
            row_result.map(DatabaseRow::PostgreSQL)
        });
        Ok(Box::pin(mapped_stream))
    }

    async fn stream_query_chunked(
        &self, sql: &str, chunk_size: usize
    ) -> Result<...> {
        let stream = self.client.stream_query_chunked(sql, chunk_size).await?;
        let mapped_stream = stream.map(|row_result| {
            row_result.map(DatabaseRow::PostgreSQL)
        });
        Ok(Box::pin(mapped_stream))
    }
}
```

PostgresClient 내부에서는 연결 문자열만 보관하고, 매 쿼리 실행 시 새로운 연결을 생성한다.

```rust
#[derive(Clone)]
pub struct PostgresClient {
    conn_string: String,
}

impl PostgresClient {
    pub async fn connect(&self) -> Result<Client, Box<dyn Error>> {
        let (client, connection) = tokio_postgres::connect(&self.conn_string, NoTls).await?;
        
        // 커넥션 핸들러를 별도 태스크에서 실행
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                error!("Database connection error: {}", e);
            }
        });
        
        Ok(client)
    }
    
    fn mask_password(&self, conn_string: &str) -> String {
        // 로그에 비밀번호 노출 방지
        if let Some(start) = conn_string.find(':') {
            if let Some(end) = conn_string[start + 1..].find('@') {
                let prefix = &conn_string[0..start + 1];
                let suffix = &conn_string[start + 1 + end..];
                return format!("{}*****{}", prefix, suffix);
            }
        }
        "postgresql://user:****@host:port/dbname".to_string()
    }
}
```

`mask_password` 메서드는 사소해 보이지만 중요하다. 로그에 DB 비밀번호가 노출되면 보안 사고로 이어질 수 있다. 연결 정보를 로깅할 때는 항상 비밀번호를 마스킹한다.

`tokio::spawn`으로 커넥션 핸들러를 분리하는 것은 `tokio-postgres`의 설계 특성이다. 커넥션 객체는 소켓 통신을 위한 비동기 루프를 돌려야 하므로, 별도 태스크에서 실행해야 한다. 이 태스크가 종료되면 커넥션이 끊어진다.

## MySQL 구현

MySQL 구현체는 `mysql_async`를 사용한다.

```rust
#[derive(Clone)]
pub struct MysqlClient {
    pool: Pool,
}

impl MysqlClient {
    pub fn with_config(mysql_config: &config::MysqlConfig) -> Self {
        let connection_string = config::get_mysql_connection_string(mysql_config);
        let opts = Opts::from_url(&connection_string)
            .expect("Failed to create MySQL pool options");
        let pool = Pool::new(opts);
        Self { pool }
    }

    pub async fn connect(&self) -> Result<Conn, Box<dyn Error>> {
        let conn = self.pool.get_conn().await?;
        Ok(conn)
    }

    pub async fn check_connectivity(&self) -> Result<(), Box<dyn Error>> {
        let mut conn = self.connect().await?;
        let result: Option<i32> = conn.query_first("SELECT 1").await?;
        
        match result {
            Some(1) => Ok(()),
            _ => Err("Database connectivity check failed".into()),
        }
    }
}
```

PostgreSQL과 MySQL 클라이언트의 가장 큰 차이는 커넥션 풀 관리다. `mysql_async`는 `Pool` 타입이 내장 커넥션 풀을 제공하므로 `pool.get_conn().await?`로 풀에서 커넥션을 빌려올 수 있다. 반면 `tokio-postgres`는 커넥션 풀이 내장되어 있지 않아, 매번 새 커넥션을 생성하거나 별도의 풀 라이브러리(deadpool-postgres 등)를 사용해야 한다.

현재 구현에서는 PostgreSQL도 매 쿼리마다 새 커넥션을 생성한다. 검색 쿼리 처리는 OpenSearch가 담당하고, DB 접근은 인덱싱 시에만 발생하므로 커넥션 생성 오버헤드가 병목이 되지 않는다. 인덱싱은 분 단위의 긴 작업이므로, 초당 수천 번의 DB 연결이 필요한 OLTP 워크로드와는 다르다.

### MySQL 행 → JSON 변환

MySQL의 행 데이터를 JSON으로 변환하는 과정에서 타입 매핑이 까다롭다.

```rust
pub fn mysql_row_to_json(
    row: &MysqlRow,
    column_map: &HashMap<String, String>
) -> HashMap<String, Value> {
    let mut result = HashMap::new();
    let columns = row.columns();
    
    for (i, column) in columns.iter().enumerate() {
        let db_col_name = column.name_str().to_string();
        
        // 컬럼맵에서 OpenSearch 필드명 조회
        let field_name = column_map
            .get(&db_col_name)
            .unwrap_or(&db_col_name);
        
        if let Some(value) = row.as_ref(i) {
            let json_value = match value {
                MysqlValue::NULL => Value::Null,
                MysqlValue::Bytes(bytes) => {
                    // UTF-8 문자열로 변환 시도, 실패하면 base64
                    match String::from_utf8(bytes.clone()) {
                        Ok(s) => Value::String(s),
                        Err(_) => Value::String(base64::encode(bytes)),
                    }
                }
                MysqlValue::Int(i) => json!(*i),
                MysqlValue::UInt(u) => json!(*u),
                MysqlValue::Float(f) => json!(*f),
                MysqlValue::Double(d) => json!(*d),
                MysqlValue::Date(y, m, d, h, mi, s, us) => {
                    Value::String(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                        y, m, d, h, mi, s, us
                    ))
                }
                MysqlValue::Time(neg, d, h, m, s, us) => {
                    let sign = if *neg { "-" } else { "" };
                    Value::String(format!(
                        "{}{}:{:02}:{:02}.{:06}",
                        sign, d * 24 + *h as u32, m, s, us
                    ))
                }
            };
            
            result.insert(field_name.clone(), json_value);
        }
    }
    
    result
}
```

MySQL의 `MysqlValue::Bytes` 타입은 문자열, BLOB, JSON 등 다양한 타입이 바이트 배열로 들어온다. UTF-8 변환을 먼저 시도하고, 실패하면 base64로 인코딩한다. 이 방어적 처리가 없으면 한글이 포함된 BLOB 데이터에서 패닉이 발생할 수 있다.

날짜/시간 타입도 주의가 필요하다. MySQL의 `Date` 타입은 연/월/일/시/분/초/마이크로초가 튜플로 전달되는데, OpenSearch의 날짜 포맷과 맞추기 위해 명시적으로 포매팅한다.

## SQL 빌더: DB별 쿼리 분기

동일한 데이터를 조회하더라도 PostgreSQL과 MySQL의 SQL 문법에는 차이가 있다. 이를 처리하는 SqlBuilder를 구현했다.

```rust
pub struct SqlBuilder {
    db_type: DatabaseType,
}

impl SqlBuilder {
    pub fn new(db_type: DatabaseType) -> Self {
        Self { db_type }
    }

    pub fn build_goods_query(&self, interval: &str) -> String {
        let base_query = match self.db_type {
            DatabaseType::PostgreSQL => {
                r#"
                SELECT 
                    ID as "id",
                    GOODS_NO as "goodsNo",
                    GOODS_NM as "goodsNm",
                    BRAND_NM as "brandNm",
                    SALE_PRC as "salePrc",
                    DC_RATE as "dcRate",
                    -- ... (50+ 컬럼)
                    DISP_CTG_NO as "dispCtgNo",
                    OPTION_LIST as "optionList"
                FROM PR_GOODS_SEARCH_INTF
                WHERE 1 = 1"#
            }
            DatabaseType::MySQL => {
                r#"
                SELECT 
                    ID as `id`,
                    GOODS_NO as `goodsNo`,
                    GOODS_NM as `goodsNm`,
                    BRAND_NM as `brandNm`,
                    SALE_PRC as `salePrc`,
                    DC_RATE as `dcRate`,
                    -- ... (50+ 컬럼)
                    DISP_CTG_NO as `dispCtgNo`,
                    OPTION_LIST as `optionList`
                FROM PR_GOODS_SEARCH_INTF
                WHERE 1 = 1"#
            }
        };
        
        // interval 조건 추가
        if !interval.is_empty() {
            let interval_clause = match self.db_type {
                DatabaseType::PostgreSQL => {
                    format!(
                        " AND SYS_MOD_DTM >= NOW() - INTERVAL '{}'",
                        interval
                    )
                }
                DatabaseType::MySQL => {
                    format!(
                        " AND SYS_MOD_DTM >= DATE_SUB(NOW(), INTERVAL {})",
                        interval
                    )
                }
            };
            format!("{}{}", base_query, interval_clause)
        } else {
            base_query.to_string()
        }
    }
}
```

PostgreSQL과 MySQL 간 주요 SQL 차이점은 다음과 같다.

| 요소 | PostgreSQL | MySQL |
|------|-----------|-------|
| 컬럼 별칭 인용 | 쌍따옴표 `"goodsNm"` | 백틱 `` `goodsNm` `` |
| 인터벌 문법 | `INTERVAL '1 hour'` | `INTERVAL 1 HOUR` |
| JSON 타입 접근 | `column->>'key'` | `JSON_EXTRACT(column, '$.key')` |
| 불리언 타입 | 네이티브 `boolean` | `TINYINT(1)` |

컬럼 별칭 인용 방식이 다른 것은 가장 빈번하게 문제를 일으키는 부분이다. PostgreSQL은 쌍따옴표 안의 별칭을 대소문자 구분하여 정확히 사용하지만, MySQL은 백틱을 사용한다. 이 차이를 무시하면 컬럼 매핑이 깨져서 OpenSearch에 잘못된 필드명으로 인덱싱되는 참사가 벌어진다.

인터벌 문법 차이도 중요하다. 증분 인덱싱에서 "최근 1시간 이내 변경된 데이터"를 조회할 때, PostgreSQL은 `INTERVAL '1 hour'`, MySQL은 `INTERVAL 1 HOUR` 형태를 사용한다. SqlBuilder에서 이 차이를 흡수하여 상위 계층은 단순히 interval 문자열만 전달하면 된다.

## 팩토리 패턴과 커넥션 캐싱

`create_database_client` 함수는 설정에 따라 적절한 구현체를 생성한다. 여기에 `lazy_static` 기반 캐싱을 적용해 불필요한 클라이언트 재생성을 방지했다.

```rust
lazy_static! {
    static ref MYSQL_CLIENT_CACHE: Mutex<Option<Arc<MysqlClient>>> = Mutex::new(None);
    static ref POSTGRES_CLIENT_CACHE: Mutex<Option<Arc<PostgresClient>>> = Mutex::new(None);
}

pub fn create_database_client(config: &AppConfig) -> Box<dyn DatabaseClient> {
    match config.database_type {
        DatabaseType::PostgreSQL => {
            let mut cache = POSTGRES_CLIENT_CACHE.lock().unwrap();
            if let Some(cached) = cache.as_ref() {
                return Box::new(PostgreSQLDatabase::new((**cached).clone()));
            }
            
            let client = PostgresClient::with_config(&config.postgres);
            *cache = Some(Arc::new(client.clone()));
            Box::new(PostgreSQLDatabase::new(client))
        }
        DatabaseType::MySQL => {
            let mut cache = MYSQL_CLIENT_CACHE.lock().unwrap();
            if let Some(cached) = cache.as_ref() {
                return Box::new(MySQLDatabase::new((**cached).clone()));
            }
            
            let client = MysqlClient::with_config(&config.mysql);
            *cache = Some(Arc::new(client.clone()));
            Box::new(MySQLDatabase::new(client))
        }
    }
}
```

캐싱이 필요한 이유는 `MysqlClient`가 내부에 커넥션 풀(`Pool`)을 가지고 있기 때문이다. 매번 새로운 `MysqlClient`를 생성하면 매번 새로운 풀이 만들어지고, 기존 커넥션이 재활용되지 않는다. `Arc`로 감싸서 캐싱하면 동일한 풀을 공유한다.

반환 타입이 `Box<dyn DatabaseClient>`인 것은 이 함수의 호출자가 구체적인 DB 타입을 알 필요가 없도록 하기 위함이다. 서비스 계층에서는 오직 `DatabaseClient` 트레잇의 메서드만 사용한다.

```mermaid
flowchart TD
    A[DbFetchService] -->|calls| B[create_database_client]
    B -->|"config.database_type"| C{"DB Type?"}
    C -->|PostgreSQL| D[POSTGRES_CLIENT_CACHE]
    C -->|MySQL| E[MYSQL_CLIENT_CACHE]
    D -->|"cache hit"| F[PostgreSQLDatabase]
    D -->|"cache miss"| G["새 PostgresClient 생성"]
    G --> F
    E -->|"cache hit"| H[MySQLDatabase]
    E -->|"cache miss"| I["새 MysqlClient 생성"]
    I --> H
    F -->|"Box dyn DatabaseClient"| A
    H -->|"Box dyn DatabaseClient"| A
```

## DbFetchService: 추상화 계층 사용

인덱싱 서비스에서 DB 추상화 계층을 실제로 사용하는 코드는 다음과 같다.

```rust
pub struct DbFetchService {
    pg_client: PostgresClient,         // 기본 PostgreSQL 클라이언트
    database_type: DatabaseType,
    db_client: Option<Box<dyn DatabaseClient>>,  // MySQL용 (옵션)
    config: Arc<AppConfig>,
}

impl DbFetchService {
    pub fn new(pg_client: PostgresClient) -> Self {
        let config = Arc::new(load_config());
        
        // MySQL인 경우에만 추가 클라이언트 생성
        let db_client = match config.database_type {
            DatabaseType::MySQL => Some(create_database_client(&config)),
            DatabaseType::PostgreSQL => None,
        };

        Self {
            pg_client,
            database_type: config.database_type.clone(),
            db_client,
            config,
        }
    }

    pub async fn fetch_data_for_indexing(
        &self,
        index_type: &str,
        interval: &str,
    ) -> Result<Vec<IndexingData>, AppError> {
        match self.database_type {
            DatabaseType::PostgreSQL => {
                // PostgreSQL 연결 검증
                self.validate_connection().await?;
                
                // Repository 패턴으로 데이터 페치
                let repository = create_repository(index_type, self.pg_client.clone())?;
                repository.fetch_data(interval).await
            }
            DatabaseType::MySQL => {
                // DatabaseClient 트레잇으로 데이터 페치
                let client = self.db_client.as_ref()
                    .ok_or(AppError::new("500", "MySQL client not initialized"))?;
                
                let sql_builder = SqlBuilder::new(DatabaseType::MySQL);
                let sql = sql_builder.build_goods_query(interval);
                
                let rows = client.query_rows(&sql).await?;
                self.convert_rows_to_indexing_data(rows, index_type)
            }
        }
    }
}
```

PostgreSQL 경로는 Repository 패턴을 사용하고, MySQL 경로는 `DatabaseClient` 트레잇을 직접 사용한다. 이 비대칭은 의도적이다. PostgreSQL은 메인 DB이므로 인덱스 타입별로 특화된 Repository(`GoodsRepository`, `MarketingRepository` 등)가 존재하지만, MySQL은 일부 고객사에서만 사용하므로 범용적인 접근으로 충분하다.

## 스트리밍 쿼리의 실전 적용

대량 데이터를 처리할 때 `query_rows`로 전체를 메모리에 올리면 OOM 위험이 있다. 스트리밍 쿼리를 사용하면 한 행씩(또는 청크 단위로) 처리할 수 있다.

```rust
// PostgreSQL 스트리밍 쿼리
pub async fn stream_query(&self, sql: &str) -> Result<
    Pin<Box<dyn Stream<Item = Result<Row, Box<dyn Error + Send + Sync>>> + Send>>,
    Box<dyn Error>,
> {
    let client = self.connect().await?;
    
    // PostgreSQL의 서버사이드 커서를 활용
    let statement = client.prepare(sql).await?;
    let row_stream = client.query_raw(&statement, std::iter::empty::<&str>()).await?;
    
    Ok(Box::pin(row_stream.map(|r| r.map_err(|e| Box::new(e) as Box<dyn Error + Send + Sync>))))
}

// 청크 기반 스트리밍 (더 큰 단위로 처리)
pub async fn stream_query_chunked(
    &self,
    sql: &str,
    chunk_size: usize,
) -> Result<...> {
    let client = self.connect().await?;
    let statement = client.prepare(sql).await?;
    let row_stream = client.query_raw(&statement, std::iter::empty::<&str>()).await?;
    
    // chunks_timeout으로 일정 크기 또는 시간 단위로 배치 처리
    let chunked = row_stream
        .chunks(chunk_size)
        .flat_map(|chunk| {
            futures::stream::iter(chunk.into_iter())
        });
    
    Ok(Box::pin(chunked))
}
```

스트리밍과 스트리밍 벌크 프로세서를 결합하면 전체 파이프라인이 완성된다.

```mermaid
sequenceDiagram
    participant DB as Database
    participant DF as DbFetchService
    participant CH as mpsc Channel
    participant SP as StreamingBulkProcessor
    participant OS as OpenSearch

    DF->>DB: stream_query_chunked(sql, 5000)
    loop 청크 단위
        DB-->>DF: chunk (5000 rows)
        DF->>CH: send(IndexingData)
        CH-->>SP: receive
        SP->>OS: bulk index
        OS-->>SP: result
    end
```

이 파이프라인에서 DB 페치와 OpenSearch 인덱싱이 동시에 진행된다. DB에서 다음 청크를 읽는 동안 이전 청크는 OpenSearch에 인덱싱되고 있다. `mpsc` 채널이 이 두 작업을 연결하는 버퍼 역할을 한다.

## 컬럼 매핑 파일

DB 컬럼명과 OpenSearch 필드명의 매핑은 JSON 파일로 관리한다.

```json
// columns_map/goods_map.json
{
    "ID": "id",
    "GOODS_NO": "goodsNo",
    "GOODS_NM": "goodsNm",
    "BRAND_NM": "brandNm",
    "SALE_PRC": "salePrc",
    "DC_RATE": "dcRate",
    "DISP_CTG_NO": "dispCtgNo",
    "OPTION_LIST": "optionList"
}
```

이 매핑 파일이 필요한 이유는 DB 스키마와 검색 인덱스 스키마가 다르기 때문이다. DB에서는 `GOODS_NM`(대문자 스네이크케이스)을 사용하지만, OpenSearch에서는 `goodsNm`(카멜케이스)을 사용한다. 또한 DB에는 존재하지만 검색에 불필요한 컬럼을 매핑에서 제외하여 인덱스 크기를 줄인다.

인덱스 타입별로(goods, marketing, event, ranking, synonym) 별도의 매핑 파일이 존재한다. 새로운 인덱스 타입을 추가할 때는 매핑 JSON 파일만 추가하면 된다.

## 트러블슈팅

### MySQL 한글 인코딩 문제

MySQL에서 한글 상품명을 읽을 때 `MysqlValue::Bytes`로 들어오는데, 일부 레거시 테이블이 `latin1` 인코딩을 사용하고 있어 `String::from_utf8`이 실패하는 경우가 있었다. 연결 문자열에 `charset=utf8mb4`를 명시하여 해결했다.

```
mysql://user:pass@host:3306/db?charset=utf8mb4
```

### PostgreSQL 대량 쿼리 타임아웃

수십만 건을 한 번에 조회할 때 PostgreSQL의 `statement_timeout`에 걸리는 문제가 있었다. 인덱싱 쿼리는 장시간 실행되므로 config에서 별도의 타임아웃을 설정했다.

```rust
pub struct PostgresConfig {
    pub statement_timeout: Duration,     // 일반 쿼리: 30초
    pub connection_timeout: Duration,    // 연결: 10초
}
```

인덱싱 전용 연결에서는 `statement_timeout`을 30분으로 설정했다. 일반 쿼리 연결과 인덱싱 연결의 타임아웃을 분리하는 것이 핵심이다.

### 동시 접근 시 Mutex 데드락

초기에는 `MYSQL_CLIENT_CACHE`를 `RwLock`으로 구현했다가 동시 인덱싱 요청에서 데드락이 발생했다. 원인은 `RwLock`의 읽기 잠금을 보유한 상태에서 캐시 미스 시 쓰기 잠금을 요청하는 패턴이었다. `Mutex`로 변경하고, 잠금 보유 시간을 최소화하여 해결했다.

## 성과와 회고

DB 추상화 레이어를 도입한 후 새로운 고객사 온보딩 시간이 크게 단축되었다. PostgreSQL 고객사는 설정 파일만 변경하면 되고, MySQL 고객사는 `database_type`을 `MySQL`로 설정하고 연결 정보를 추가하면 동일한 인덱싱 파이프라인이 동작한다. NestJS 버전에서는 고객사별로 코드 브랜치를 관리해야 했던 것과 비교하면 운영 복잡도가 획기적으로 줄었다.

Rust의 트레잇 시스템은 이런 추상화에 매우 적합했다. 컴파일 타임에 `DatabaseClient`를 구현하는 모든 타입이 필요한 메서드를 제공하는지 검증하므로, 새로운 DB를 추가할 때(예: Oracle) 누락되는 메서드가 없다. 비동기 트레잇의 타입 시그니처가 복잡한 것은 단점이지만, 한 번 정의하면 사용하는 쪽에서는 DB 종류를 전혀 신경 쓰지 않아도 된다.

남은 과제로는 Oracle DB 지원, 커넥션 풀 통합(PostgreSQL에도 내장 풀 적용), 그리고 스키마 마이그레이션 자동화가 있다. 특히 커머스 도메인에서는 고객사마다 테이블 스키마가 미묘하게 다른 경우가 있어, 매핑 파일을 자동으로 생성하는 도구가 필요하다.
