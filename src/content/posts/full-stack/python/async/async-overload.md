---
title: 파이썬 비동기 작업의 과부하 제어
description: 비동기 I/O에서 동시 작업 수가 과도하면 오히려 성능이 저하되는 문제를 다룬다. Chunking/Batching 기법으로
  작업을 일정 크기로 나누어 부하를 제어하는 방법을 정리한다.
pubDatetime: 2024-09-30
tags:
- Python
- 비동기
- asyncio
- Batching
- 성능최적화
- Full Stack
---


비동기 프로그래밍에서 I/O 작업을 처리할 때 한 번에 너무 많은 작업을 실행하면, 오히려 성능이 저하 될 수 있다. 예를 들어, 파일 시스템에서 동시에 너무 많은 파일을 열거나 네트워크 상에서 한 번에 너무 많은 연결을 맺으면 서버에 과도한 부하가 발생할 수 있다.  또는 비동기 작업의 수가 지나치게 많아지면, 운영체제가 자주 컨텍스트 스위칭을 하게 되어 성능이 저하될 수 있다.

이를 해결하기 위한 방법 중 하나가 `chunking` 또는 `batching` 기법으로, 작업을 일정한 크기(chunks)로 나누어 처리하는 것이다. 즉, 비동기 작업을 한꺼번에 모두 실행하는 대신 작업의 묶음(batch)으로 나누어 순차적으로 처리하여 부하를 조절하는 방법이다.

예를 들어, 1000개의 파일을 처리해야 할 때, 한 번에 100개의 파일만 열고, 그 파일들이 처리되면 그 다음 100개를 처리하는 방식이다.

**Chunk Size 방식의 동작 방식**

1. 작업 나누기
2. 순차 처리
3. 비동기적으로 실행

```python
import asyncio

# 비동기적으로 파일을 처리하는 함수 (예: 읽기, 쓰기)
async def process_file(file):
    print(f"Processing {file}")
    await asyncio.sleep(1)  # 파일 처리에 1초 걸린다고 가정

# 작업을 일정한 크기(chunk_size)로 나누어 처리하는 함수
async def process_files_in_chunks(files, chunk_size):
    for i in range(0, len(files), chunk_size):
        # 파일들을 chunk로 나누어서 처리
        chunk = files[i:i + chunk_size]
        await asyncio.gather(*[process_file(file) for file in chunk])
        print(f"Processed chunk: {chunk}")

# 메인 함수
async def main():
    # 예시 파일 리스트
    files = [f"file_{i}" for i in range(20)]
    
    # 한 번에 5개 파일씩 처리
    await process_files_in_chunks(files, 5)

# asyncio 이벤트 루프 실행
asyncio.run(main())

```

1. `process_file` 함수
    1. 파일을 처리하는 비동기 함수이다.
2. `process_files_in_chunks`
    1. 전체 파일 리스트를 chunk 로 나누어 처리하는 함수
    2. 한 번에 chunk_size 만큼의 파일을 비동기적으로 처리하고, 그 다음 chunk로 넘어간다.
    3. 예를 들어, 20개의 파일을 한 번에 5개씩 묶어서 비동기적으로 처리하고, 각 chunk가 완료되면 다음 5개의 파일을 처리한다.
3. `asyncio.gather()`
    1. gather는 여러 비동기 작업을 동시에 처리할 때 사용