---
title: 'aiohttp로 임베딩 API 클라이언트 만들기: 타임아웃과 배치 분할 최적화'
description: llama.cpp 임베딩 서버와 통신하는 aiohttp 비동기 클라이언트를 구현하며 세션 재사용, 커넥션 타임아웃 설정, 대용량
  텍스트 배치 분할, 지수 백오프 재시도 로직을 최적화한 과정.
pubDatetime: 2025-12-30
tags:
- Python
- aiohttp
- 임베딩
- llama.cpp
- 비동기
- RAG
- AI
---


## 배경

XGEN RAG 시스템의 임베딩은 llama-cpp로 구동되는 별도 임베딩 서버에서 처리한다. XGEN 워크플로우 서비스에서 이 서버에 HTTP 요청을 보내 텍스트를 벡터로 변환한다.

초기 구현은 매 요청마다 새로운 HTTP 세션을 열고 닫았다. 임베딩 요청이 잦은 RAG 시스템에서 이 방식은 세션 생성 오버헤드가 상당했다. 또한 llama-cpp 서버가 무거운 요청을 처리하는 동안 타임아웃이 너무 짧으면 연결이 끊기고, 너무 길면 실제 장애를 감지하지 못한다.

세 가지를 개선했다. 영구 세션 유지, 타임아웃 세분화, 배치 분할 + 재시도.

```
# 2025-12-01 커밋: feat: Refactor CustomHTTPEmbedding client for improved functionality and logging
# 2025-12-01 커밋: feat: Update timeout settings and batch size in CustomHTTPEmbedding
# 2025-12-30 커밋: feat: Enhance CustomHTTPEmbedding with persistent session management
```

## 클래스 구조

```python
# src/service/embedding/custom_http_embedding.py

import aiohttp
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class CustomHTTPEmbedding:
    """llama-cpp 임베딩 서버 HTTP 클라이언트"""

    def __init__(
        self,
        api_url: str,
        api_key: Optional[str] = None,
        timeout_total: int = 120,
        timeout_connect: int = 10,
        timeout_sock_read: int = 60,
        batch_size: int = 5,
        max_retries: int = 3,
    ):
        self.api_url = api_url
        self.api_key = api_key
        self.timeout = aiohttp.ClientTimeout(
            total=timeout_total,
            connect=timeout_connect,
            sock_read=timeout_sock_read,
        )
        self.batch_size = batch_size
        self.max_retries = max_retries
        self._session: Optional[aiohttp.ClientSession] = None
        self._connector: Optional[aiohttp.TCPConnector] = None
```

## 영구 세션 관리

### TCPConnector 설정

```python
async def _ensure_session(self) -> aiohttp.ClientSession:
    """세션이 닫혔거나 없으면 새로 생성"""
    if self._session is None or self._session.closed:
        self._connector = aiohttp.TCPConnector(
            limit=100,              # 전체 동시 연결 최대
            limit_per_host=30,     # 호스트당 동시 연결 최대
            ttl_dns_cache=300,     # DNS 캐시 5분
            force_close=False,     # keep-alive 활성화
            enable_cleanup_closed=True,
        )

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        self._session = aiohttp.ClientSession(
            connector=self._connector,
            timeout=self.timeout,
            headers=headers,
        )
        logger.info("New aiohttp session created for %s", self.api_url)

    return self._session

async def close(self) -> None:
    """세션 명시적 종료"""
    if self._session and not self._session.closed:
        await self._session.close()
        self._session = None
    if self._connector and not self._connector.closed:
        await self._connector.close()
        self._connector = None
```

매번 `aiohttp.ClientSession()`을 새로 만들면 TCP 연결을 매번 새로 맺는다. `force_close=False`로 keep-alive를 활성화하고 커넥터를 재사용하면 반복 요청에서 연결 수립 오버헤드가 없어진다.

### 타임아웃 세분화

```python
self.timeout = aiohttp.ClientTimeout(
    total=120,       # 전체 요청 완료까지 최대 2분
    connect=10,      # TCP 연결 수립 타임아웃 10초
    sock_read=60,    # 데이터 수신 타임아웃 60초
)
```

`total`, `connect`, `sock_read`를 분리한 이유가 있다.

- **connect=10**: 서버가 죽어있으면 10초 안에 감지. 너무 길면 장애 전파가 느려진다.
- **sock_read=60**: llama-cpp는 긴 텍스트 임베딩에 시간이 걸린다. 읽기 타임아웃은 여유있게.
- **total=120**: 재시도 포함 전체 시간 제한. 무한정 대기하지 않도록.

초기에는 `total=30`으로 설정했다가 긴 문서(수천 토큰) 임베딩에서 타임아웃이 발생했다. llama-cpp 서버의 처리 시간 특성을 보고 120초로 늘렸다.

## 배치 분할 처리

### 배치 크기 5의 이유

```python
self.batch_size = 5   # llama-cpp 안정성 기준
```

한 번에 보내는 텍스트 수를 제한하는 이유는 llama-cpp 서버의 메모리 사용량 때문이다. 배치를 크게 보내면 서버 메모리가 급증하고 OOM이 발생할 수 있다. 실험 결과 배치 크기 5가 안정성과 처리 속도의 균형점이었다.

```python
async def embed(self, texts: list[str]) -> list[list[float]]:
    """텍스트 목록을 배치로 분할해서 임베딩"""
    all_embeddings = []

    # 배치 분할
    batches = [
        texts[i:i + self.batch_size]
        for i in range(0, len(texts), self.batch_size)
    ]

    for batch_idx, batch in enumerate(batches):
        logger.debug(
            "Processing batch %d/%d (%d texts)",
            batch_idx + 1, len(batches), len(batch)
        )
        embeddings = await self._embed_batch_with_retry(batch)
        all_embeddings.extend(embeddings)

    return all_embeddings
```

## 재시도 로직

```python
async def _embed_batch_with_retry(
    self,
    texts: list[str],
) -> list[list[float]]:
    last_error = None

    for attempt in range(self.max_retries):
        try:
            return await self._embed_batch(texts)

        except aiohttp.ClientConnectorError as e:
            # 연결 자체가 안 됨 — 세션 재생성 후 재시도
            logger.warning(
                "Connection error (attempt %d/%d): %s",
                attempt + 1, self.max_retries, e
            )
            await self.close()  # 세션 초기화
            last_error = e

        except aiohttp.ServerTimeoutError as e:
            logger.warning(
                "Timeout (attempt %d/%d): %s",
                attempt + 1, self.max_retries, e
            )
            last_error = e

        except Exception as e:
            logger.error("Unexpected error: %s", e)
            raise

        # 지수 백오프
        if attempt < self.max_retries - 1:
            wait_time = 2 ** attempt  # 1초, 2초, 4초
            logger.info("Retrying in %ds...", wait_time)
            await asyncio.sleep(wait_time)

    raise RuntimeError(
        f"Failed after {self.max_retries} attempts: {last_error}"
    )
```

`ClientConnectorError`는 세션이 오염된 경우도 있어서 세션 자체를 `close()` 후 재생성한다. 다음 `_embed_batch()` 호출 시 `_ensure_session()`이 새 세션을 만들어준다.

## 실제 임베딩 요청

```python
async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
    session = await self._ensure_session()

    payload = {
        "input": texts,
        "model": "text-embedding",  # llama-cpp 서버 모델명
        "encoding_format": "float",
    }

    async with session.post(
        f"{self.api_url}/v1/embeddings",
        json=payload,
    ) as response:
        response.raise_for_status()
        data = await response.json()

    # OpenAI 호환 응답 파싱: data[].embedding
    if "data" not in data:
        raise ValueError(f"Unexpected response format: {data.keys()}")

    embeddings = [item["embedding"] for item in data["data"]]

    if len(embeddings) != len(texts):
        raise ValueError(
            f"Expected {len(texts)} embeddings, got {len(embeddings)}"
        )

    return embeddings
```

llama-cpp 서버는 OpenAI API 형식을 따른다. 응답 형태는 `{"data": [{"embedding": [...], "index": 0}, ...]}`.

응답 건수(`len(embeddings)`)가 요청 건수(`len(texts)`)와 다르면 즉시 에러를 낸다. 이 불일치가 발생하면 벡터 인덱스가 꼬여서 나중에 디버깅하기 어려운 버그가 된다.

## 컨텍스트 매니저 지원

```python
async def __aenter__(self):
    return self

async def __aexit__(self, exc_type, exc_val, exc_tb):
    await self.close()
```

`async with` 문으로 사용할 수 있게 해서 세션 누수를 방지한다.

```python
# 사용 예
async with CustomHTTPEmbedding(api_url="http://localhost:8002") as client:
    embeddings = await client.embed(["안녕하세요", "테스트 문장"])
```

## 싱글턴으로 앱 수명 동안 세션 유지

FastAPI 앱에서는 앱 시작 시 한 번 생성하고 앱 종료 시 닫는 방식을 사용했다.

```python
# src/main.py
from contextlib import asynccontextmanager

embedding_client: CustomHTTPEmbedding | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global embedding_client
    embedding_client = CustomHTTPEmbedding(
        api_url=settings.EMBEDDING_API_URL,
        batch_size=5,
        timeout_total=120,
    )
    yield
    # 종료 시 세션 정리
    if embedding_client:
        await embedding_client.close()

app = FastAPI(lifespan=lifespan)
```

lifespan 컨텍스트 매니저로 관리하면 앱이 살아있는 동안 하나의 세션이 유지되고, 종료 시 깔끔하게 정리된다.

## 로깅 전략

```python
# 배치 시작
logger.debug("Processing batch %d/%d (%d texts)", batch_idx+1, len(batches), len(batch))

# 성공
logger.debug("Batch %d completed in %.2fs", batch_idx+1, elapsed)

# 재시도
logger.warning("Connection error (attempt %d/%d): %s", attempt+1, max_retries, e)

# 세션 재생성
logger.info("New aiohttp session created for %s", self.api_url)
```

`DEBUG` 레벨에 배치 처리 상세 정보, `WARNING` 레벨에 재시도 발생, `INFO` 레벨에 세션 생성을 기록한다. 운영 환경에서는 INFO 이상만 보이게 해서 로그가 과도하게 쌓이지 않도록 했다.

## 결과

- 세션 재사용으로 반복 임베딩 요청에서 TCP 연결 오버헤드 제거
- 타임아웃 세분화(connect/sock_read/total)로 장애 감지와 처리 시간 여유를 균형 있게 설정
- 배치 크기 5로 llama-cpp 서버 OOM 방지
- 재시도 + 지수 백오프 + 세션 재생성으로 일시적 연결 장애 자동 복구

임베딩 클라이언트는 RAG 파이프라인의 병목이 되기 쉽다. 세션 관리와 타임아웃 설정을 제대로 해두지 않으면 고부하에서 조용히 실패하거나 응답이 무한정 지연되는 문제가 생긴다.
