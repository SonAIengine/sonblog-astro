---
title: LangChain PydanticOutputParser — LLM 출력을 구조화된 데이터로 변환
description: LangChain의 PydanticOutputParser를 활용해 LLM 출력을 타입이 명확한 구조화된 데이터로 파싱하는 방법을
  정리한다. Pydantic 모델 정의, 포맷 인스트럭션 생성, 유효성 검사 과정을 다룬다.
pubDatetime: 2025-07-20
tags:
- RAG
- 검색엔진
- LangChain
- Pydantic
- LLM
- Python
- Search Engine
---


`PydanticOutputParser`는 LangChain에서 제공하는 도구로, 대형 언어 모델(LLM)의 출력 결과를 Pydantic 모델 기반의 구조화된 데이터로 파싱하기 위해 사용된다. 이를 통해 자연어 혹은 JSON 형태로 생성된 LLM의 응답을 타입이 명확한 데이터로 변환할 수 있다.


## 목적

`PydanticOutputParser`의 주요 목적은 다음과 같다:

- LLM 출력 결과를 **Pydantic 모델에 맞게 파싱**하여 구조화된 형태로 제공한다.
    
- 출력값에 대해 **타입 유효성 검사를 수행**함으로써 신뢰도를 높인다.
    
- **후속 처리에 적합한 데이터 형태로 정제**함으로써 다른 시스템과의 연동이나 분석을 가능하게 한다. 


## 기본 사용 예시

```python
from langchain.output_parsers import PydanticOutputParser
from pydantic import BaseModel

class Answer(BaseModel):
    question: str
    answer: str

parser = PydanticOutputParser(pydantic_object=Answer)

# 프롬프트 예시
prompt = f"""
다음 형식에 따라 답변하십시오:
{parser.get_format_instructions()}

질문: '한국의 수도는 어디인가?'
"""

# LLM의 응답 예시
llm_output = """
{
  "question": "한국의 수도는 어디인가?",
  "answer": "서울"
}
"""

# 파싱 실행
parsed = parser.parse(llm_output)
print(parsed.question)  # → "한국의 수도는 어디인가?"
print(parsed.answer)    # → "서울"
```


## 주요 메서드

|메서드명|설명|
|---|---|
|`parse(text: str)`|LLM의 출력 텍스트를 지정된 Pydantic 모델로 파싱한다.|
|`get_format_instructions()`|LLM이 어떤 형식으로 응답을 출력해야 하는지에 대한 포맷 가이드를 문자열로 반환한다.|


## 활용 전략

- 프롬프트 템플릿과 함께 사용하여 LLM이 JSON 형식의 구조화된 출력을 생성하도록 유도할 수 있다.
    
- 파싱된 결과는 다른 API, 데이터베이스, 또는 UI에 그대로 연결 가능한 상태로 제공되므로 **후처리가 간단**하다.
    
- Pydantic의 validation 기능을 통해 응답 구조를 **검증 및 예외 처리**하는 데 활용할 수 있다.

## 유의사항

- `PydanticOutputParser`는 LLM이 JSON 형식을 정확히 따르도록 프롬프트를 정교하게 설계해야 제대로 작동한다.
    
- 모델 출력이 JSON 형식을 벗어나거나 누락된 필드를 포함할 경우 `ValidationError`가 발생할 수 있다. 이 경우 예외 처리를 통해 보완하거나 `OutputFixingParser`와 같이 사용하는 것이 일반적이다.

LangChain에서 복잡한 언어 모델 응답을 다룰 때, `PydanticOutputParser`는 구조화된 데이터 기반 파이프라인을 구축하는 데 매우 유용한 도구이다.


추가로,

```
model = ChatOpenAI(model_name="gpt-4o", temperature=0.0)
```

`temperature` 를 0.0 으로 설정하여 AI가 더욱 일관된 답변을 할 수 있도록 합니다.

```python
class FinancialAdvice(BaseModel):
	setup: str = Feild(description="금융 조언 상황을 설정하기 위한 질문")
	advice: str = Field(description="질문을 해결하기 위한 금융 답변")

	@model_validator(mode="before")
	@classmethod
	def question_ends_with_question_mark(cls, values: dict) -> dict:
		setup = values.get("setup", "")
		if not setup.endswith("?"):
			raise ValueError("질문된 질문 형식입니다! 질문은 '?'로 끝나야 합니다.")
		return values
```

`Pydantic` 을 사용하여 FinancialAdvice 라는 클래스를 정의한다. 이 클래스는 AI 모델이 제공하는 데이터를 구조화된 형태로 저장하기 위한 데이터 모델을 만든다.

`BaseModel` 은 `Pydantic` 의 기본 모델 클래스로 데이터를 구조화하고 검증하는 데 사용되며, `Field`는 각 필드에 대한 설명과 유효성 검증 정보를 추가하는 데 사용된다.

`setup` 필드는 금융 조언 상황을 나타내는 질문을, `advice` 필드는 해당 질문에 대한 구체적인 금융 조언 답변을 저장하는 역할을 한다.

또한 `model_validator` 데코레이터를 사용해 사용해 질문 형식이 올바른지 검증하는 로직을 추가했다. 
이 로직은 `question_ends_with_question_mark()` 라는 클래스 메서드에서 처리된다. 

AI가 생성한 질문이 물음표(?) 로 끝나는지 확인하며, 그렇지 않을 경우 ValueError를 발생시켜 "잘못된 질문 형식입니다! 질문은 '?'로 끝나야 합니다." 라는 오류 메시지를 반환한다.

결과적으로 FinancialAdvice 모델을 사용하면 질문과 답변을 명확하게 구분할 수 있으며, AI 응답의 형식적 오류를 방지할 수 있다.

```python
parser = PydanticOutPutParser(pydantic_object=FiancialAdvice)
prompt = PromptTemplate(
	template="다음 금융 관련 질문에 답변해 주세요. \n{format_instructions}\n질문: {query}\n",
	input_vriables=["query"]
	partial_variables={"format_instructions": parser.get_format_instructions()},
)

# 언어 모델을 사용해 데이터 구조를 채우도록 프롬프트와 모델 설정
chain = prompt | model | parser
```

```python
try: 
	result = chain.invoke({"query": "부동산에 관련하여 금융 조언을 받을 수 있게 질문하라."})
	print(result)
except: Exception as e:
	print(f"오류 발생: {e}")
```


### 전체 코드
```python
from pydantic import BaseModel, Field, field_validator
from langchain_openai import ChatOpenAI
from langchain.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv
import os

# .env 파일에서 환경변수 로드
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    raise EnvironmentError("OPENAI_API_KEY가 .env에 설정되지 않았습니다.")

# 언어 모델 설정
model = ChatOpenAI(
    model_name="gpt-4o-mini",
    temperature=0.0,
    api_key=api_key,
)

# 금융 조언 모델 정의
class FinancialAdvice(BaseModel):
    setup: str = Field(description="금융 조언 상황을 설정하기 위한 질문")
    advice: str = Field(description="질문을 해결하기 위한 금융 답변")

    @field_validator("setup")
    @classmethod
    def question_must_end_with_question_mark(cls, v):
        if not v.strip().endswith("?"):
            raise ValueError("잘못된 질문 형식입니다! 질문은 '?'로 끝나야 합니다.")
        return v

# 출력 파서 설정
parser = PydanticOutputParser(pydantic_object=FinancialAdvice)

# 프롬프트 템플릿 정의
prompt = PromptTemplate(
    template=(
        "다음 금융 관련 질문에 대해 조언을 작성해 주세요.\n"
        "{format_instructions}\n"
        "주의: 'setup'은 반드시 질문 형식이며, '?'로 끝나야 합니다.\n"
        "질문: {query}"
    ),
    input_variables=["query"],
    partial_variables={"format_instructions": parser.get_format_instructions()},
)

# 체인 구성
chain = prompt | model | parser

# 테스트 실행
if __name__ == "__main__":
    try:
        result = chain.invoke({"query": "주식 투자 시 고려해야 할 점은 무엇인가요"})
        print("질문:", result.setup)
        print("답변:", result.advice)
    except Exception as e:
        print(f"오류 발생: {e}")
```