---
title: RAG 챗봇 대화 기록 유지 — 메모리 관리 전략과 구현
description: RAG 기반 챗봇에서 대화 이력을 유지하고 관리하는 메모리 전략을 정리한다. 프롬프트에 이력 직접 삽입, 요약 메모리, 토큰
  제한 윈도우 등 실용적인 대화 관리 방법을 다룬다.
pubDatetime: 2025-07-20
tags:
- RAG
- 검색엔진
- 챗봇
- 대화메모리
- LangChain
- LLM
- Search Engine
---


## 1. 대화 이력이 중요한 이유

챗봇이 사용자의 질문을 기억하고 맥락에 맞게 답변하면 대화 경험이 자연스러워진다. 반대로 이전 메시지를 고려하지 못하면 질문-답변이 단절되어 사용자는 불편함을 느낀다. 따라서 **대화 이력을 효과적으로 관리하는 메모리 계층**은 실용적인 챗봇 개발에서 필수 요소이다.


## 2. 가장 단순한 방법: 프롬프트에 이력 그대로 넣기

가장 쉬운 접근은 이전 메시지들을 그대로 모델에 전달하는 방식이다.

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# 1) 프롬프트와 체인 구성
prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "당신은 친절한 재무 상담가이다."),
        ("human", "{user_input}")
    ]
)
llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.0)
chain = prompt | llm

# 2) 이전 대화 이력을 그대로 넣어 호출
ai_msg = chain.invoke(
    {
        "user_input": "저축을 늘리기 위해 무엇을 할 수 있나요?"
    }
)
print(ai_msg)
```

- **장점**: 구현이 쉽다.
    
- **단점**: 대화가 길어질수록 프롬프트 크기가 커져 토큰 비용이 증가하고 응답 속도가 느려진다.

## 3. 체계적인 이력 관리: `ChatMessageHistory` 활용

LangChain 등 라이브러리에서는 `ChatMessageHistory` 클래스를 제공한다. 이 객체는 대화 메시지를 리스트 형태로 저장하며, 새 질문이 올 때마다 `add_user_message`, `add_ai_message` 메서드로 이력을 갱신한다. 이렇게 하면 **저장, 조회, 삭제**가 명확해져 코드 유지보수가 수월하다.

```python
from langchain.memory import ChatMessageHistory
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# 1) 대화 이력 객체 생성
history = ChatMessageHistory()
history.add_user_message("저축을 늘리려면?")
history.add_ai_message("지출 분석부터 시작하라.")

# 2) 체인 정의
prompt = ChatPromptTemplate.from_messages(history.messages + [("human", "{question}")])
llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.0)
chain = prompt | llm

# 3) 새 질문 처리
response = chain.invoke({"question": "신용카드 사용을 줄이는 방법은?"})
print(response)
```


## 4. 대화 이력 최적화 전략

### 4-1. 메시지 트리밍

가장 최근 N개 메시지만 남기고 오래된 기록을 삭제하는 방식이다.

```python
MAX_TURNS = 3          # 최근 3턴만 유지
PAIR = 2               # user+ai 한 쌍

if len(history.messages) > MAX_TURNS * PAIR:
    history.messages = history.messages[-MAX_TURNS * PAIR :]
```

- **장점**: 구현이 간단하며 최신 맥락은 유지된다.
    
- **단점**: 오래된 정보가 완전히 사라지므로 장기 의존성이 있는 대화에서는 맥락 손실이 발생할 수 있다.

### 4-2. 대화 요약

삭제 대신 **요약 메시지**로 압축해 보존하는 기법이다. 오래된 메시지들을 요약하고, 원문을 제거한 후 요약 결과만 남겨 두는 패턴이다.

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import PromptTemplate
from langchain.output_parsers import StrOutputParser

# 1) 요약 체인 정의
summary_prompt = PromptTemplate(
    template=(
        "다음 대화를 두세 문장으로 요약하라. "
        "핵심 숫자와 고유명사는 그대로 유지하라.\n\n{dialogue}"
    ),
    input_variables=["dialogue"],
)
summarizer = summary_prompt | ChatOpenAI(model_name="gpt-4o-mini", temperature=0.0) | StrOutputParser()

# 2) 요약 대상 선정: 최근 3턴(6메시지)을 제외
old_msgs = history.messages[:-6]
dialogue_text = "\n".join([msg.content for msg in old_msgs])

# 3) 요약 실행
summary = summarizer.invoke({"dialogue": dialogue_text})

# 4) 원문 삭제 후 요약 메시지로 대체
history.messages = history.messages[-6:]       # 최근 3턴만 남김
history.add_system_message(f"요약: {summary}")
```

- **장점**: 맥락을 보존하면서 토큰 수를 크게 줄일 수 있다.
    
- **단점**: 요약 오류가 발생하면 핵심 정보가 왜곡될 수 있다. 따라서 모델 지시에 **“핵심 사실은 구체적인 숫자·고유명사로 남겨라”** 같은 제약을 명확히 주어야 한다.

## 5. 트리밍과 요약을 결합한 하이브리드 패턴

현실 서비스에서는 **“최근 대화는 원문 유지, 더 이전은 요약 보관, 그보다 오래된 것은 삭제”**와 같은 다단계 전략이 효과적이다.

|구간|처리 방안|
|---|---|
|최근 1 ~ 3턴|원문 유지|
|4 ~ 10턴 사이|요약 저장|
|10턴 이후|완전 삭제|

이렇게 하면 **즉시 필요한 맥락은 정확히**, **장기적인 이야기 흐름은 요약으로**, **불필요하게 긴 과거 데이터는 제거**할 수 있다.

## 6. 위험 요소와 모범 사례

|위험 요소|방지 방법|
|---|---|
|요약 과정의 정보 손실|중요 키워드·숫자를 그대로 남기도록 시스템 지시 추가|
|사용자 개인정보 노출|요약 전에 PII 마스킹 로직 삽입|
|토큰 한도 초과로 인한 오류|트리밍 또는 요약 후 토큰 길이 검증 함수로 최종 확인|
|멀티 세션 간 이력 충돌|사용자 ID별 분리된 메모리 저장소 사용|


## 7. 결론

대화형 AI의 품질은 **맥락 유지 능력**에서 결정된다.

- **프롬프트 직삽 방식**은 빠르지만 스케일에 한계가 있다.
    
- **`ChatMessageHistory`** 기반 구조화 저장은 유지보수를 돕는다.
    
- **트리밍**은 속도를, **요약**은 장기 맥락을 보존한다.
    
- 두 기법을 상황에 맞게 조합하면 **응답 지연·비용·맥락 손실**을 균형 있게 관리할 수 있다.


챗봇 개발자는 서비스 특성에 따라 **메시지 보존 주기, 요약 주체(모델·규칙 기반), 개인정보 처리 정책**을 명확히 정의해야 한다. 이를 통해 사용자는 끊김 없는 대화를 경험하고, 운영자는 리소스를 효율적으로 활용할 수 있다.


## 추가) chatMessageHistory 이란?

### 1. `ChatMessageHistory`가 데이터를 보관하는 위치

`ChatMessageHistory` 클래스 자체는 **단순한 파이썬 리스트 래퍼**이다. 즉, 객체가 생성된 프로세스의 **메모리(RAM)** 에만 데이터를 저장한다. 파일, 데이터베이스, 캐시 서버 등에 자동으로 쓰지 않으며, 별도의 직렬화 로직도 내장돼 있지 않다.

```python
from langchain.memory import ChatMessageHistory

history = ChatMessageHistory()     # 내부적으로 self.messages = [] 형태
history.add_user_message("안녕?")
history.add_ai_message("안녕하세요.")
```

위 코드에서 대화 내용은 `history.messages` 리스트에만 저장되어 있기 때문에, 같은 파이썬 프로세스 안에서만 유효하다.


### 2. 데이터 보존 기간

`ChatMessageHistory`는 **명시적으로 삭제하거나 프로세스가 종료될 때까지** 메시지를 보관한다.  
별도의 TTL(Time-to-Live)이나 만료 정책은 없으므로, 다음 중 하나가 일어나기 전까지 기록은 계속 남아 있다.

1. 사용자가 직접 `history.messages = [...]` 혹은 `history.clear()` 등으로 삭제
    
2. 애플리케이션 로직에서 트리밍, 요약 등으로 기록을 덮어쓰기
    
3. 파이썬 프로세스가 종료

### 3. 서버를 재시작하면 기록이 남는가

기본 구현만 사용할 경우 **남지 않는다**. 서버(=파이썬 프로세스)를 재시작하면 메모리 내용이 모두 초기화되기 때문에 `ChatMessageHistory` 역시 사라진다.


### 4. 영속 저장이 필요한 경우

LangChain은 다양한 **“Persistent Memory”** 구현체를 함께 제공한다. 원리는 동일하지만, 내부 저장소가 Redis·SQL·파일 시스템 등으로 바뀐다. 대표 예시는 다음과 같다.

|메모리 클래스|저장 매체|특징|
|---|---|---|
|`RedisChatMessageHistory`|Redis|빠른 접근 속도, TTL 설정 가능|
|`PostgresChatMessageHistory`|PostgreSQL|관계형 데이터베이스 사용, 쿼리·백업 용이|
|`ChatMessageHistory` + Pickle|로컬 파일|커스텀 직렬화 코드 필요|
|`SimpleDirectoryChatMessageHistory`|디렉터리(텍스트)|대화별 파일로 저장, Git 관리 가능|

#### 예시: Redis에 저장

```python
from langchain.memory import RedisChatMessageHistory

history = RedisChatMessageHistory(
    session_id="user123",      # 사용자·세션 식별자
    url="redis://localhost:6379/0", 
    ttl=60 * 60 * 24           # 선택: 24시간 후 만료
)
history.add_user_message("안녕?")
```

이렇게 하면 서버를 재시작해도 Redis에 남아 있기 때문에 기록이 유지된다.


### 5. 실무 설계 권장 사항

1. **세션 식별자 분리**  
    멀티 사용자 서비스라면 `session_id` 또는 `user_id` 단위로 히스토리를 구분해야 충돌을 막을 수 있다.
    
2. **TTL 또는 트리밍 정책**  
    대화가 길어지면 저장 공간과 토큰 비용이 증가하므로, 만료시간(TTL)이나 트리밍 로직을 설정하는 편이 좋다.
    
3. **보안·개인정보 관리**  
    외부 저장소(Redis, RDBMS)에 기록을 남길 때는 암호화, 접근 제어, PII 마스킹 정책을 함께 설계해야 한다.
    
4. **백업·모니터링**  
    장기 보존이 필요하다면 정기 백업과 모니터링을 통해 데이터 손실을 방지한다.


### 6. 요약

- `ChatMessageHistory` 기본형은 **프로세스 메모리**에만 저장되며, 서버 재시작 시 기록이 사라진다.
    
- 영속성이 필요하면 Redis, Postgres 등과 연동하는 **Persistent Memory 구현**을 사용해야 한다.
    
- 저장 기간은 기본적으로 무한이며, 만료 정책은 개발자가 직접 설정해야 한다.