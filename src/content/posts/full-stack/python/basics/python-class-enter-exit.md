---
title: 파이썬 클래스의 `__enter__`와 `__exit__` 메서드
description: 파이썬 with 문에서 자동 호출되는 __enter__와 __exit__ 특수 메서드를 정리한다. 컨텍스트 매니저 프로토콜
  구현으로 파일, DB 연결, 락 등의 리소스를 안전하게 관리하는 방법을 다룬다.
pubDatetime: 2024-09-30
tags:
- Python
- Context Manager
- 디자인 패턴
- 리소스 관리
- Full Stack
---


파이썬에서 `with` 문을 사용할 때 자동으로 호출되는 특수 메서드들이다. 이들을 구현하면 **컨텍스트 매니저(Context Manager)** 프로토콜을 따르는 객체를 만들 수 있다.

## 컨텍스트 매니저란?

컨텍스트 매니저는 `with` 문에서 사용할 수 있는 객체로, 리소스의 안전한 사용과 정리를 보장한다. 파일 처리, 데이터베이스 연결, 락 관리 등에서 유용하다.

## 기본 구현 예시

```python
class MyClass:
    def __enter__(self):
        print("컨텍스트에 진입했습니다.")
        return self  # 객체 자신을 반환

    def __exit__(self, exc_type, exc_value, traceback):
        print("컨텍스트를 벗어났습니다.")
        # 예외가 발생해도 이 메서드는 반드시 호출됨
        return False  # 예외를 재발생시킴

    def do_something(self):
        print("작업을 수행합니다.")

# with 구문에서 객체를 사용
with MyClass() as obj:
    obj.do_something()
```

**실행 결과:**
```
컨텍스트에 진입했습니다.
작업을 수행합니다.
컨텍스트를 벗어났습니다.
```

## 메서드 상세 설명

### `__enter__(self)`
- `with` 문이 시작될 때 호출됨
- 반환값이 `as` 뒤의 변수에 할당됨
- 주로 리소스 획득이나 초기화 작업 수행

### `__exit__(self, exc_type, exc_value, traceback)`
- `with` 블록을 벗어날 때 호출됨 (예외 발생 시에도 반드시 호출)
- 매개변수:
  - `exc_type`: 예외 타입
  - `exc_value`: 예외 값  
  - `traceback`: 트레이스백 객체
- 반환값이 `True`면 예외를 억제, `False`면 예외를 재발생

## 실용적인 예시: 파일 관리자

```python
class FileManager:
    def __init__(self, filename, mode):
        self.filename = filename
        self.mode = mode
        self.file = None
    
    def __enter__(self):
        print(f"파일 '{self.filename}'을 열고 있습니다...")
        self.file = open(self.filename, self.mode)
        return self.file
    
    def __exit__(self, exc_type, exc_value, traceback):
        print(f"파일 '{self.filename}'을 닫고 있습니다...")
        if self.file:
            self.file.close()
        
        if exc_type:
            print(f"예외가 발생했습니다: {exc_value}")
        
        return False  # 예외를 재발생시킴

# 사용 예시
with FileManager('test.txt', 'w') as f:
    f.write("Hello, World!")
    # 파일이 자동으로 닫힘
```

## 언제 사용하면 좋을까?

1. **리소스 관리**: 파일, 네트워크 연결, 데이터베이스 연결
2. **상태 관리**: 임시 상태 변경 후 복원
3. **로깅**: 작업 시작/종료 로깅
4. **예외 처리**: 안전한 리소스 정리

컨텍스트 매니저를 사용하면 예외가 발생해도 항상 정리 작업이 수행되므로 더 안전한 코드를 작성할 수 있다.