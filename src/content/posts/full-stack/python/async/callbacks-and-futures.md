---
title: '파이썬 비동기 프로그래밍: 콜백과 퓨처'
description: 이벤트 루프 기반 비동기 프로그래밍의 두 가지 패러다임인 콜백과 퓨처를 비교한다. 콜백 지옥 문제와 퓨처를 통한 해결, 실전
  코드 패턴을 정리한다.
pubDatetime: 2024-09-30
tags:
- Python
- 비동기
- Callback
- Future
- 이벤트 루프
- Full Stack
---


이벤트 루프를 사용하는 프로그래밍에는 `콜백`과 `퓨처`라는 두 가지의 형태가 있다.

---
## 콜백

콜백 패러다임에서는 각 함수를 호출할 때 콜백이라는 인자를 넘긴다. 함수가 값을 반환하는 대신, 그 값을 인자로 실어 콜백 함수를 호출한다.
이 구조에서는 호출한 함수의 결과를 받는 함수가 더해지고, 다시 그 함수의 결과를 받는 또 다른 함수가 더해지면서 함수의 사슬이 만들어진다.
→ 이런 식으로 콜백 깊이가 깊어지는 상황을 “콜백 지옥”이라고 부른다.

```python
from functools import partial
from some_database_library import save_results_to_db

def save_value(value, callback):
    print(f"Saving {value} to database")
    # 데이터베이스에 값을 저장하고 완료되면 콜백 호출
    save_results_to_db(value, callback)
    
def print_response(db_response):
    print(f"Response from database: {db_response}")
    
if __name__ == "__main__":
    # print_response()가 아닌 함수 객체를 넘겨야 함
    eventloop.put(partial(save_value, "Hello World", print_response))
```

`save_result_to_db` 는 비동기 함수다. 이 함수가 즉시 반환되면서 함수가 종료되고 다른 코드를 실행할 수 있다.

1. save_value
    1. 이 함수는 데이터베이스에 “Hello World” 값을 저장하는 비동기 작업을 수행합니다. `save_results_to_db(value, callback)` 은 비동기 함수로, 데이터베이스에 저장이 완료되면 콜백 함수인 `callback` 을 호출한다.

2. print_response
    1. 이 함수는 데이터베이스에 저장된 후, 그 결과를 받아 처리하는 콜백 함수입니다. 결과가 들어오면 데이터베이스로부터 응답을 출력한다.

3. 이벤트 루프에 작업 추가
    1. `partial(save_value, “Hello World”, print_response)` 는 save_value 함수에 “Hello World”라는 값과 `print_response` 콜백을 함께 전달하여 새로운 함수로 만들고, 이를 이벤트 루프에 추가합니다.
    2. 이벤트 루프가 실행되면서 `save_value` 함수가 실행되고, 이 함수는 비동기적으로 데이터베이스 “Hello World” 를 저장하고 작업이 완료되면 콜백으로 `print_response` 가 호출된다.

**동작 흐름**

1. 이벤트 루프에 작업 추가
2. 이벤트 루프에서 작업 실행
3. 콜백 함수 실행

---
## 퓨처

save_results_to_db 함수가 `Future` 타입의 값을 반환한다고 할 때, 이는 해당 함수가 비동기적으로 동작하며, 함수 호출 후 즉시 결과를 반환하지 않고, 작업이 완료되었을 때 그 결과를 나중에 제공할 것을 약속하는 객체(Future) 를 반환한다는 의미입니다.

**Future 타입의 이해**

비동기 작업의 완료 상태와 결과를 나중에 받을 수 있도록 하는 객체입니다. 주로 비동기 프로그래밍에서 사용되며, I/O 작업이나 네트워크 요청과 같이 시간이 걸리는 작업에서 자주 사용된다.

1. 비동기 작업을 시작할 때, 작업은 즉시 결과를 반환하지 않으므로 Future 객체가 반환된다.
2. 작업이 완료되면, Future 객체는 결과 값을 가지게 되고, 이 값을 확인하거나 처리할 수 있다. 이를 통해 우리는 비동기 작업의 결과를 추적할 수 있다.
3. Future 객체는 콜백 함수를 등록할 수 있으며, 비동기 작업이 완료되었을 때 해당 콜백 함수가 실행된다.