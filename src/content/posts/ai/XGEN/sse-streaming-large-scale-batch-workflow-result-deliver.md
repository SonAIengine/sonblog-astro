---
title: SSE 스트리밍으로 대규모 배치 워크플로우 결과 전달하기
description: xgen-workflow에서 100개 이상 테스트 케이스를 배치 처리하며 진행상황을 SSE로 실시간 전달하는 아키텍처 - batch_results에서
  progress-only 방식으로의 전환, 취소 구현, Redis 세션 관리까지
pubDatetime: 2025-12-24
tags:
- SSE
- 스트리밍
- 배치처리
- FastAPI
- XGEN
- AI
---


워크플로우 테스터 기능은 여러 테스트 케이스를 한 번에 실행하고 결과를 수집하는 기능이다. 처음에는 모든 실행이 완료된 후 결과를 반환하는 방식이었다. 100개 케이스를 돌리면 HTTP 응답을 100개 케이스가 모두 완료될 때까지 기다려야 했다. 각 케이스가 10초씩 걸리면 1,000초 후에 응답이 왔다. 당연히 클라이언트는 타임아웃이 났다.

SSE(Server-Sent Events)로 진행상황을 실시간으로 전달하도록 바꾸었다. 그리고 이 과정에서 여러 번의 아키텍처 변경이 있었다.

## 아키텍처 변천사

```
# 커밋: feat: Optimize workflow tester streaming for batch processing
# 날짜: 2025-12-23 23:46

# 커밋: feat: Adjust SSE batch settings for improved performance
# 날짜: 2025-12-24 00:49

# 커밋: feat: Optimize result transmission and add results retrieval endpoint
# 날짜: 2025-12-24 16:53

# 커밋: feat: Optimize memory usage and result handling in workflow tester execution
# 날짜: 2025-12-24 18:04

# 커밋: feat: Further optimize memory management and execution flow in process_batch_group
# 날짜: 2025-12-24 18:33
```

하루 동안 5번의 최적화가 있었다. 처음 구현이 얼마나 미흡했는지를 보여준다.

## V1: batch_results 방식 (문제)

첫 번째 구현은 결과를 누적한 후 배치 단위로 전송했다.

```python
# v1 구현 (문제 있음)
async def tester_stream_generator():
    all_results = []  # 모든 결과를 메모리에 누적

    for i in range(0, len(test_cases), batch_size):
        batch = test_cases[i:i + batch_size]
        batch_results = await process_batch(batch)

        all_results.extend(batch_results)

        # 배치 결과 전체를 SSE로 전송
        yield f"data: {json.dumps({'type': 'batch_results', 'results': batch_results})}\n\n"

    # 최종 전송
    yield f"data: {json.dumps({'type': 'complete', 'all_results': all_results})}\n\n"
```

두 가지 문제가 있었다.

1. **메모리**: `all_results` 리스트에 모든 결과를 누적하면 100개 × 결과 크기만큼 메모리를 사용한다. 각 결과가 수 KB씩이면 수 MB가 메모리에 쌓인다.
2. **SSE 페이로드 크기**: 배치 결과를 한 번에 전송하면 SSE 메시지 하나가 너무 커진다. 브라우저 SSE 버퍼에 걸리거나 파싱이 느려진다.

설정값도 처음에는 너무 컸다.

```python
# v1 초기 설정 (2025-12-23)
SSE_BATCH_INTERVAL = 2.0   # 2초마다 전송
SSE_BATCH_MAX_SIZE = 50    # 50개씩 묶어서 전송
```

50개를 한 번에 SSE로 보내는 건 너무 많다.

## V2: progress-only 방식 (개선)

핵심 아이디어는 SSE로는 진행률만 전송하고, 실제 결과는 DB에 저장 후 별도 API로 조회하는 것이다.

```python
# 설정값 조정 (2025-12-24)
SSE_BATCH_INTERVAL = 3.0          # 3초마다 전송
SSE_BATCH_MAX_SIZE = 10           # 10개씩만
SSE_OUTPUT_TRUNCATE_LENGTH = 3000  # SSE에서는 3KB 제한
```

```python
@router.post("/stream")
async def execute_workflow_tester_stream(
    request: Request,
    tester_request: TesterExecuteRequest,
):
    async def tester_stream_generator():
        batch_id = str(uuid.uuid4())
        result_queue = asyncio.Queue()
        pending_results = []
        last_send_time = time.time()
        completed_count = 0
        total = len(tester_request.test_cases)

        # 시작 이벤트
        yield f"data: {json.dumps({'type': 'tester_start', 'batch_id': batch_id, 'total_count': total})}\n\n"

        # 배치 처리 백그라운드 태스크
        async def batch_processor():
            for i in range(0, total, tester_request.batch_size):
                if is_cancelled(batch_id):
                    await result_queue.put("TESTER_CANCELLED")
                    return

                batch_group = tester_request.test_cases[i:i + tester_request.batch_size]
                await process_batch_group(
                    batch_group,
                    individual_result_callback=lambda r: result_queue.put_nowait(r),
                )

            await result_queue.put("TESTER_COMPLETE")

        batch_task = asyncio.create_task(batch_processor())

        # 결과 버퍼링 및 progress 전송
        async def flush_pending_results():
            nonlocal pending_results, completed_count
            if not pending_results:
                return None

            completed_count += len(pending_results)
            progress_message = {
                "type": "progress",
                "batch_id": batch_id,
                "completed_count": completed_count,
                "total_count": total,
                "progress": round((completed_count / total) * 100, 2),
            }
            pending_results = []
            last_send_time = time.time()
            return f"data: {json.dumps(progress_message, ensure_ascii=False)}\n\n"

        # 큐 소비 루프
        while True:
            try:
                result = await asyncio.wait_for(
                    result_queue.get(),
                    timeout=SSE_BATCH_INTERVAL,
                )

                if result == "TESTER_COMPLETE":
                    flush_data = await flush_pending_results()
                    if flush_data:
                        yield flush_data
                    yield f"data: {json.dumps({'type': 'tester_complete', 'batch_id': batch_id, 'total_completed': completed_count})}\n\n"
                    break

                elif result == "TESTER_CANCELLED":
                    yield f"data: {json.dumps({'type': 'tester_cancelled', 'batch_id': batch_id})}\n\n"
                    return

                elif isinstance(result, TesterTestResult):
                    pending_results.append(result)

                    should_flush = (
                        len(pending_results) >= SSE_BATCH_MAX_SIZE or
                        (time.time() - last_send_time) >= SSE_BATCH_INTERVAL
                    )
                    if should_flush:
                        flush_data = await flush_pending_results()
                        if flush_data:
                            yield flush_data

            except asyncio.TimeoutError:
                # 연결 유지 ping (60초마다)
                if (time.time() - last_send_time) >= 60.0:
                    yield f"data: {json.dumps({'type': 'ping'})}\n\n"

    return StreamingResponse(
        tester_stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

SSE로는 `{"type": "progress", "completed": 15, "total": 100, "progress": 15.0}` 같은 진행률만 전송한다. 실제 결과는 DB에 저장되고, 클라이언트는 완료 후 별도 API로 조회한다.

### 결과 조회 엔드포인트 분리

```python
@router.get("/results/{batch_id}")
async def get_tester_results(
    request: Request,
    batch_id: str,
    page: int = 1,
    page_size: int = 20,
):
    """배치 완료 후 결과 페이지네이션 조회"""
    db = get_db_manager(request)

    results = await db.query(
        "SELECT * FROM tester_results WHERE batch_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3",
        batch_id, page_size, (page - 1) * page_size
    )

    return {
        "batch_id": batch_id,
        "page": page,
        "results": results,
    }
```

SSE는 실시간성만 제공하고, 데이터는 REST API로 조회한다. 클라이언트는 SSE로 완료를 감지한 후 `/results/{batch_id}`로 결과를 가져간다.

## 취소 기능

```
# 커밋: feat: Implement cancellation functionality for tester execution
# 날짜: 2025-12-24 15:57
```

100개 케이스를 돌리다가 중간에 멈추고 싶은 경우가 있다. 취소 상태를 공유하는 간단한 방식을 사용했다.

```python
# 취소 상태 관리 (인메모리)
_cancelled_batches: Set[str] = set()

def cancel_batch(batch_id: str):
    _cancelled_batches.add(batch_id)

def is_cancelled(batch_id: str) -> bool:
    return batch_id in _cancelled_batches

@router.post("/cancel/{batch_id}")
async def cancel_tester(batch_id: str):
    cancel_batch(batch_id)
    return {"status": "cancelling", "batch_id": batch_id}
```

배치 처리 루프에서 각 그룹 처리 전에 취소 여부를 확인한다.

```python
async def batch_processor():
    for i in range(0, total, batch_size):
        if is_cancelled(batch_id):
            await result_queue.put("TESTER_CANCELLED")
            return

        batch_group = test_cases[i:i + batch_size]
        await process_batch_group(batch_group, ...)
```

현재 처리 중인 그룹은 완료하고 다음 그룹부터 중단한다. 즉시 중단이 아닌 그룹 단위 취소다.

## process_batch_group: 병렬 → 순차 전환

```
# 커밋: feat: Further optimize memory management and execution flow in process_batch_group
# 날짜: 2025-12-24 18:33
```

초기에는 그룹 내 케이스들을 병렬로 처리했다.

```python
# 초기: 병렬 처리
async def process_batch_group(batch, callback):
    tasks = [execute_workflow(case) for case in batch]
    results = await asyncio.gather(*tasks)
    for result in results:
        await callback(result)
```

문제는 병렬로 10개 워크플로우가 동시에 돌면 LLM 서버에 10개 요청이 동시에 들어간다는 것이다. LLM 서버가 동시 요청을 잘 처리하지 못하면 타임아웃이 발생했다.

순차 처리로 전환했다.

```python
# 변경 후: 순차 처리
async def process_batch_group(batch, callback):
    for case in batch:
        result = await execute_workflow(case)
        await callback(result)  # 각 케이스 완료 즉시 콜백
```

속도는 느려지지만 LLM 서버 부하가 예측 가능해졌다. 그리고 각 케이스 완료 즉시 콜백을 호출하므로 SSE에 더 빠르게 반영된다.

## XGEN 2.0: Redis 기반 세션 관리

XGEN 2.0에서는 배치 실행을 더 견고하게 만들었다.

```python
# 배치 세션 Redis 키 구조
BATCH_SESSION_PREFIX     = "batch:session:{batch_id}"      # 세션 데이터
BATCH_ACTIVE_USER_PREFIX = "batch:active_user:{user_id}"   # 사용자별 활성 배치
BATCH_CANCEL_PREFIX      = "batch:cancel:{batch_id}"       # 취소 요청
BATCH_SESSION_TTL        = 3600 * 4                        # 4시간 TTL
```

XGEN 2.0의 배치 스트리밍은 다른 전략을 택했다. SSE로는 시작 이벤트만 보내고, 실제 실행은 완전히 백그라운드로 분리한다.

```python
@router.post("/stream")
async def execute_batch_stream(
    request: Request,
    batch_request: TesterExecuteRequest,
):
    async def batch_stream_generator():
        batch_id = str(uuid.uuid4())
        await create_batch_session(batch_id, ...)

        # 백그라운드 태스크 시작
        task = asyncio.create_task(
            run_batch_in_background(batch_id, batch_request, ...)
        )
        _background_tasks[batch_id] = task

        # SSE로는 시작 이벤트 하나만 전송 후 종료
        yield f"data: {json.dumps({'event': 'batch_start', 'batch_id': batch_id})}\n\n"
        # 연결 종료 - 클라이언트는 /status로 폴링

    return StreamingResponse(
        batch_stream_generator(),
        media_type="text/event-stream",
    )
```

SSE 연결은 시작 이벤트를 보낸 후 즉시 끊린다. 클라이언트는 이후 `/batch/{batch_id}/status`로 폴링해서 진행 상황을 확인한다.

### Redis 세션 수명 주기

```python
async def run_batch_in_background(batch_id: str, ...):
    """백그라운드 배치 실행"""
    WORKFLOW_REFRESH_INTERVAL = 10  # 10개마다 executor 정리

    for idx, test_case in enumerate(test_cases):
        # N개마다 메모리 정리
        if idx > 0 and idx % WORKFLOW_REFRESH_INTERVAL == 0:
            execution_manager.cleanup_completed_executions()
            gc.collect()
            await asyncio.sleep(1.0)  # 정리 시간

        # 취소 확인
        if await is_batch_cancelled(batch_id, redis):
            await complete_batch_session(batch_id, "cancelled", db)
            return

        # 워크플로우 실행 (5분 타임아웃)
        try:
            result = await asyncio.wait_for(
                execute_workflow_for_batch(test_case, ...),
                timeout=300,
            )
        except asyncio.TimeoutError:
            result = create_error_result("timeout")

        completed_count += 1

        # Redis 진행 상태 업데이트
        await update_batch_progress(batch_id, completed_count, redis)

    # 완료: DB에 저장, Redis에서 삭제
    await complete_batch_session(batch_id, "completed", db)
```

실행 중에는 Redis만 업데이트한다. 완료 후 DB에 저장하고 Redis는 즉시 삭제한다. Redis를 실시간 상태 저장소로, DB를 영구 보존 저장소로 역할 분리한다.

## execution_core.py: 공유 실행 핵심

XGEN 2.0에서 워크플로우 실행 로직을 하나의 핵심 함수로 추출했다.

```python
async def execute_workflow_core(
    workflow_id: str,
    input_data: Dict[str, Any],
    ...
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    HTTP 요청 없이 워크플로우를 실행하는 공유 핵심 로직.
    SSE 엔드포인트, 배치 평가기, 스케줄러가 모두 이 함수를 재사용.
    """
    async for chunk in result_generator:
        if isinstance(chunk, str):
            chunk_str = error_message_replacer(chunk)
            full_response_chunks.append(chunk_str)

            yield {"type": "data", "content": chunk_str}

            # 스트리밍 느낌 제공 (청크 5개 이하면 non-streaming으로 판단)
            is_streaming_mode = chunk_count > 5
            if is_streaming_mode:
                await asyncio.sleep(0.01)

    yield {"type": "end", "message": "완료"}
```

SSE 엔드포인트, 배치 평가기, 스케줄러가 모두 이 함수를 사용한다. 실행 로직이 한 곳에 있으므로 수정이 한 번에 반영된다.

## X-Accel-Buffering 헤더

Nginx를 앞에 두는 경우 SSE가 버퍼링되는 문제가 있다. Nginx는 기본적으로 응답을 버퍼링하므로 SSE 이벤트가 실시간으로 전달되지 않는다.

```python
return StreamingResponse(
    tester_stream_generator(),
    media_type="text/event-stream",
    headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",   # Nginx 버퍼링 비활성화
    },
)
```

`X-Accel-Buffering: no` 헤더로 Nginx 버퍼링을 끈다. 이 헤더가 없으면 Nginx가 SSE 이벤트를 모았다가 한꺼번에 보내서 실시간성이 없어진다.

## 회고

배치 처리 + SSE 구현에서 가장 많은 시간이 걸린 부분은 메모리 관리였다. 결과를 메모리에 누적하다가 결국 "SSE로는 진행률만, 결과는 DB"로 방향을 잡은 게 맞는 선택이었다.

병렬 처리를 순차 처리로 바꾼 것도 처음에는 퇴보처럼 느껴졌지만, LLM 서버의 동시 요청 처리 한계를 고려하면 현실적인 선택이었다. LLM API가 아닌 로컬 vLLM을 쓰는 환경에서 동시 요청이 많아지면 큐잉이 길어지고 타임아웃이 발생한다. 순차 처리가 전체 처리량을 오히려 높이는 경우도 있다.

XGEN 2.0의 "SSE로 시작만, 실행은 백그라운드" 패턴은 더 견고하다. HTTP 연결 타임아웃 걱정 없이 실행이 가능하고, 클라이언트가 재연결해도 `/status` API로 현재 상태를 확인할 수 있다.
