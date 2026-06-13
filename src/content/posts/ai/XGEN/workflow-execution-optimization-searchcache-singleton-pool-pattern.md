---
title: Python 싱글턴 풀 패턴으로 배치 실행 메모리 누수 해결하기
description: RAG 워크플로우를 배치로 100건 이상 반복 실행할 때 발생하는 메모리 누수를 싱글턴 풀 패턴으로 해결한 과정. LLM 클라이언트,
  검색 캐시, RAG 서비스의 객체 재사용 설계와 캐시 비활성화의 역설적 결정.
pubDatetime: 2025-12-24
tags:
- 싱글턴
- 메모리최적화
- Python
- 워크플로우
- XGEN
- AI
---


# 워크플로우 실행 메모리 최적화: SearchCache 싱글턴 풀 패턴

RAG 워크플로우를 배치로 돌릴 때 메모리 문제가 발생했다. 테스트 케이스 100개를 순차적으로 실행하면 시간이 갈수록 메모리 사용량이 올라갔다. 각 실행마다 LLM 클라이언트, RAGService, 검색 캐시가 새로 생성되고 제대로 정리되지 않았다.

```
# 커밋: feat: Implement memory optimization in SearchCache and introduce LLM and RAGService singleton pools
# 날짜: 2025-12-24 09:48

# 커밋: feat: Enhance SearchCache with memory optimization and cleanup features
# 날짜: 2025-12-24 09:01
```

이 문제를 해결하기 위해 세 가지 싱글턴 패턴을 도입했다.

## 문제: 매 실행마다 새 객체 생성

초기 구현에서 `IterativeSearchEngine`은 매 워크플로우 실행마다 새로 생성됐다.

```python
# 문제가 있는 초기 패턴
async def execute_vectordb_node(node_config: dict, query: str):
    engine = IterativeSearchEngine(
        llm=ChatOpenAI(...),           # 매번 새 LLM 클라이언트
        rag_client=RAGServiceClient(), # 매번 새 HTTP 클라이언트
        cache=SearchCache(),           # 매번 새 캐시
        config=SearchConfig(**node_config),
    )
    return await engine.search(query)
```

LLM 클라이언트는 HTTP 연결 풀을 내부적으로 관리한다. 100번 실행하면 100개의 연결 풀이 생기고, GC가 이를 즉시 정리하지 않아 메모리가 쌓였다.

## SearchCache: 캐시 비활성화의 역설

SearchCache를 싱글턴으로 만들면서 흥미로운 결정을 했다. 캐시 기능 자체를 꺼버렸다.

```python
class SearchCache:
    """검색 결과 캐싱 싱글턴"""

    _instance = None
    _ttl: int = 60           # 1분 TTL (기존보다 대폭 축소)
    _max_cache_size: int = 10  # 최대 10개 항목

    def __init__(self):
        self._cache: Dict[str, Tuple[float, Any]] = {}

    @classmethod
    def get_instance(cls) -> "SearchCache":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def clear_instance(cls):
        """싱글톤 인스턴스와 캐시 완전 초기화"""
        if cls._instance is not None:
            cls._instance._cache.clear()
            cls._instance = None

    def get(self, collection: str, query: str) -> Optional[Any]:
        # 대량 테스트 시 캐시로 인한 메모리 문제 방지를 위해 비활성화
        return None

    def set(self, collection: str, query: str, data: Any):
        # 캐시 비활성화 - 메모리 절약
        pass

    def _make_key(self, collection: str, query: str) -> str:
        return hashlib.md5(f"{collection}:{query}".encode()).hexdigest()
```

캐시를 싱글턴으로 만들었지만 실제 캐싱은 하지 않는다. `get()`은 항상 None을 반환하고, `set()`은 아무것도 저장하지 않는다.

이 결정의 배경은 이렇다. 대량 배치 테스트에서 동일한 쿼리가 반복되는 경우가 드물다. 반면 캐시가 메모리를 차지하면 다른 컴포넌트가 사용할 메모리가 부족해진다. 캐시의 이득보다 비용이 크다고 판단해서 일단 꺼두었다.

`clear_instance()`는 배치 테스트가 끝날 때 호출해서 싱글턴 자체를 초기화한다. 다음 배치는 완전히 새로운 상태에서 시작한다.

## LLMPool: 동일 설정 LLM 재사용

```python
class LLMPool:
    """LLM 인스턴스 재사용 풀"""

    _instance = None
    _llm_cache: Dict[str, Any] = {}

    @classmethod
    def get_instance(cls) -> "LLMPool":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def get_llm(
        self,
        provider: str,
        model: str,
        base_url: str | None = None,
        temperature: float = 0.1,
    ) -> Any:
        """동일 설정의 LLM은 재사용"""
        key = f"{provider}:{model}:{base_url or ''}:{temperature}"

        if key not in self._llm_cache:
            llm = self._create_llm(provider, model, base_url, temperature)
            self._llm_cache[key] = llm
            logger.info(f"[LLMPool] 새 LLM 인스턴스 생성: {key}")
        else:
            logger.debug(f"[LLMPool] LLM 인스턴스 재사용: {key}")

        return self._llm_cache[key]

    def _create_llm(
        self,
        provider: str,
        model: str,
        base_url: str | None,
        temperature: float,
    ) -> Any:
        if provider == "openai":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=model,
                base_url=base_url,
                temperature=temperature,
            )
        elif provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=model, temperature=temperature)
        else:
            raise ValueError(f"Unknown provider: {provider}")

    @classmethod
    def clear(cls):
        """풀 초기화"""
        if cls._instance:
            cls._instance._llm_cache.clear()
```

같은 모델, 같은 base_url, 같은 temperature 조합이면 동일한 LLM 인스턴스를 반환한다. 배치 100회 실행에서 LLM 클라이언트는 설정이 같은 한 하나만 생성된다.

키에 temperature까지 포함시킨 이유는 노드 설정마다 temperature가 다를 수 있기 때문이다. 검색 관련성 평가 노드는 낮은 temperature(0.0~0.1)를, 창의적 답변 생성 노드는 높은 temperature(0.7)를 쓸 수 있다.

## RAGServicePool: HTTP 클라이언트 재사용

```python
class RAGServicePool:
    """RAGServiceClient 싱글턴"""

    _instance = None
    _client: Optional["RAGServiceClient"] = None

    @classmethod
    def get_client(cls) -> "RAGServiceClient":
        if cls._client is None:
            cls._client = RAGServiceClient()
            logger.info("[RAGServicePool] RAGServiceClient 생성")
        return cls._client

    @classmethod
    def clear(cls):
        cls._client = None
        cls._instance = None
```

RAGServiceClient는 내부적으로 httpx.AsyncClient를 사용한다. AsyncClient는 커넥션 풀을 관리하는데, 매번 새로 생성하면 연결을 재사용하지 못한다. 싱글턴으로 유지하면 xgen-retrieval 서버와의 HTTP 연결을 재사용할 수 있다.

## 사용 패턴

세 가지 싱글턴을 노드 실행 코드에서 이렇게 사용한다.

```python
async def execute_vectordb_node(node_config: dict, query: str):
    # 싱글턴 풀에서 인스턴스 가져오기
    llm_pool = LLMPool.get_instance()
    rag_pool = RAGServicePool.get_client()
    cache = SearchCache.get_instance()

    engine = IterativeSearchEngine(
        llm=llm_pool.get_llm(
            provider=node_config["llm_provider"],
            model=node_config["llm_model"],
            base_url=node_config.get("llm_base_url"),
        ),
        rag_client=rag_pool,
        cache=cache,
        config=SearchConfig(**node_config),
    )
    return await engine.search(query)
```

IterativeSearchEngine 자체는 매 실행마다 생성되지만 내부 의존성(LLM, RAGClient, Cache)은 재사용된다.

## WorkflowExecutionManager: 좀비 프로세스 방지

개별 컴포넌트 레벨의 싱글턴 외에, 워크플로우 실행 자체를 관리하는 `WorkflowExecutionManager`도 싱글턴으로 구현했다.

```python
class WorkflowExecutionManager:
    """워크플로우 실행 관리 싱글턴"""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls, workflow_max_workers: int = 10):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, workflow_max_workers: int = 10):
        if hasattr(self, '_initialized') and self._initialized:
            return

        self.executor_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=workflow_max_workers,
            thread_name_prefix="workflow-executor",
        )
        self.active_executions: Dict[str, AsyncWorkflowExecutor] = {}
        self._execution_lock = threading.Lock()
        self._initialized = True
```

더블 체크 락킹(Double-Checked Locking) 패턴을 사용했다. 멀티스레드 환경에서 싱글턴 초기화가 두 번 일어나는 것을 방지한다.

### 완료된 실행 정리

실행이 완료된 executor를 메모리에서 정리하는 로직이 중요하다.

```python
def cleanup_completed_executions(self):
    """완료된 실행 정리"""
    with self._execution_lock:
        completed_ids = []
        for execution_id, executor in self.active_executions.items():
            status = executor.get_execution_status()
            if status['status'] in ['completed', 'error', 'cancelled']:
                completed_ids.append(execution_id)

        for execution_id in completed_ids:
            del self.active_executions[execution_id]

        if completed_ids:
            logger.info(f"정리된 실행: {len(completed_ids)}개")
```

XGEN 2.0에서는 이를 자동화했다.

```python
# XGEN 2.0 강화형: 5분마다 자동 정리 + 2시간 좀비 강제 종료
CLEANUP_INTERVAL = 300   # 5분
MAX_AGE_SECONDS = 7200   # 2시간

def create_executor(self, execution_id: str, ...):
    current_time = time.time()
    with self._execution_lock:
        # 주기적 자동 정리
        if current_time - self._last_cleanup_time > self._cleanup_interval:
            self._cleanup_stale_executions_unlocked()
            self._last_cleanup_time = current_time

        self.active_executions[execution_id] = executor
        self._execution_timestamps[execution_id] = current_time

def _cleanup_stale_executions_unlocked(self):
    """완료된 실행 + 2시간 초과 좀비 강제 정리"""
    for execution_id, executor in list(self.active_executions.items()):
        status = executor.get_execution_status()
        if status['status'] in ['completed', 'error', 'cancelled']:
            del self.active_executions[execution_id]
            continue

        created_time = self._execution_timestamps.get(execution_id, 0)
        if current_time - created_time > MAX_AGE_SECONDS:
            # 2시간 이상 실행 중인 좀비 강제 제거
            executor.cancel()
            del self.active_executions[execution_id]
            logger.warning(f"좀비 실행 강제 정리: {execution_id}")
```

오류나 타임아웃으로 완료 신호를 보내지 못한 실행이 active_executions에 영구적으로 남는 문제를 해결했다.

## FastAPI 의존성 주입과 싱글턴

FastAPI에서는 `request.app.state`를 활용한 또 다른 싱글턴 패턴을 사용한다.

```python
# singletonHelper.py
def get_db_manager(request: Request) -> DatabaseClient:
    """DB 매니저 의존성 주입"""
    if hasattr(request.app.state, 'app_db') and request.app.state.app_db:
        return request.app.state.app_db

    # 처음 호출 시 생성 후 app.state에 저장
    app_db = DatabaseClient()
    request.app.state.app_db = app_db
    return request.app.state.app_db

def get_config_composer(request: Request) -> Any:
    """ConfigClient 의존성 주입"""
    if hasattr(request.app.state, 'config_composer') and request.app.state.config_composer:
        return request.app.state.config_composer

    config_composer = ConfigClient()
    request.app.state.config_composer = config_composer
    return request.app.state.config_composer
```

FastAPI 라우터에서:

```python
@router.post("/execute")
async def execute_workflow(
    request: Request,
    db: DatabaseClient = Depends(get_db_manager),
    config: ConfigClient = Depends(get_config_composer),
):
    # db와 config는 앱 수명 동안 하나의 인스턴스 재사용
    ...
```

`request.app.state`는 FastAPI 앱의 수명과 함께한다. 서버가 살아있는 동안 같은 인스턴스가 재사용된다.

## 회고

메모리 최적화에서 가장 효과적이었던 것은 역설적으로 SearchCache를 꺼버린 것이었다. 캐시가 없으면 매번 새로 검색하므로 속도는 느려지지만, 메모리는 일정하게 유지된다. 배치 테스트에서는 동일 쿼리가 반복되는 경우가 드물어 캐시 히트율도 낮았다.

LLMPool과 RAGServicePool은 눈에 띄는 효과를 냈다. 배치 100개 실행 시 메모리 증가 속도가 크게 줄었다. GC는 즉시 객체를 수집하지 않으므로, 객체를 아예 생성하지 않는 게 최선이다.

완료된 실행을 정리하는 `cleanup_completed_executions()`를 배치 N개마다 명시적으로 호출하는 것도 중요했다. Python GC는 순환 참조가 있으면 즉시 수거하지 못한다. 비동기 태스크 객체에는 순환 참조가 생기기 쉽다. 명시적으로 dict에서 제거해주는 게 안전하다.
