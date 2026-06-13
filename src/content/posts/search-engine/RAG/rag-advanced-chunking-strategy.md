---
title: RAG 청킹 전략 — 문서 분할 방식 비교와 최적화
description: RAG 시스템의 문서 전처리 핵심인 청킹 전략을 정리한다. 문자 수 기반, 토큰 기반, 재귀적 분할, 시맨틱 청킹 등 다양한
  분할 방식의 장단점과 검색 정확도에 미치는 영향을 다룬다.
pubDatetime: 2025-07-20
tags:
- RAG
- 검색엔진
- 청킹
- 문서전처리
- LangChain
- 시맨틱검색
- Search Engine
---


문서 전처리는 RAG(Retrieval-Augmented Generation) 시스템에서 핵심적인 전처리 과정 중 하나이다. 이 단계는 원본 문서를 검색과 생성에 적합한 형태로 가공하여, 검색 정확도와 생성 품질을 모두 향상시키는 데 목적이 있다.

## 문서 분할(청킹, Chunking)의 중요성

문서 분할은 전처리의 핵심으로, 긴 문서를 작고 유의미한 단위로 나누는 작업이다. 이 과정은 정보 검색 정확도, 문맥 보존, 생성 효율성에 직결된다. 적절하게 나눈 청크는 유사도 검색의 정밀도를 높이고, LLM이 부담 없이 문맥을 이해하게 하여 응답 품질을 높이는 데 기여한다.

### 문자 수 기반 분할의 한계

가장 단순한 방식은 **문자 수 기반 분할**이다. 이는 일정한 길이마다 텍스트를 자르는 방식으로 구현이 매우 간단하고 속도가 빠르다. 그러나 문장 구조나 의미 흐름을 고려하지 않기 때문에 다음과 같은 문제가 있다.

- 핵심 정보가 잘려서 검색 시 누락 가능
    
- 문맥이 끊겨 생성 응답이 어색해질 수 있음
    
- 문서에 따라 최적의 분할이 되지 않음

## 부모-자식 분할(Parent-Child Chunking)의 개요

보다 구조화된 방식으로 문서를 분할하기 위한 전략이 **부모-자식 분할**이다. 이 방식은 단순히 텍스트 길이만 고려하지 않고 문서의 계층 구조를 보존하면서도, 검색 효율성과 문맥 이해도를 동시에 추구하는 방식이다.

### 기본 개념

부모-자식 분할은 문서를 두 단계로 나눈다.

1. **부모 문서(Parent Chunk)**: 장, 절, 큰 단락 등 문서의 주요 구획 기준으로 나눈 큰 단위
    
2. **자식 문서(Child Chunk)**: 각 부모 문서에서 다시 의미 단위로 세분화된 작은 청크
    

이로써 원본 → 부모 → 자식의 3단계 구조가 형성되며, 자식은 부모에 속한다는 관계를 메타데이터로 명시한다.

## 부모-자식 분할의 핵심 장점

1. **정확한 정보 검색**  
    검색은 자식 청크를 기준으로 수행된다. 자식은 세분화된 정보를 포함하고 있어 사용자 쿼리와 높은 관련도를 가질 가능성이 크다. 따라서 대용량 문서에서도 목표 정보를 빠르게 찾을 수 있다.
    
2. **넓은 문맥 제공**  
    검색된 자식 청크에 연결된 부모 문서를 함께 반환함으로써, 정보의 ‘맥락’을 잃지 않게 한다. 이로써 LLM이 더 풍부하고 자연스러운 응답을 생성할 수 있다.

## 인덱싱 과정

1. **문서 분할**  
    문서를 부모 단위로 먼저 나눈 후, 각 부모 단위를 자식 청크로 분할한다. 이때 의미 기반 분할 알고리즘을 활용할 수 있다.
    
2. **메타데이터 할당**  
    자식 청크에는 어떤 부모 문서에 속하는지 식별할 수 있는 ID를 메타데이터로 포함시킨다.
    
3. **벡터 저장소와 문서 저장소 분리**
    
    - 자식 문서는 임베딩을 통해 벡터 데이터베이스에 저장된다.
        
    - 부모 문서는 별도의 문서 저장소에 원형 그대로 보관된다.

## 검색 흐름

1. 사용자가 쿼리를 입력하면, 쿼리에 가장 유사한 **자식 문서**를 벡터 DB에서 검색한다.
    
2. 검색된 자식 문서의 **부모 ID**를 통해 해당 **부모 문서**를 찾는다.
    
3. 사용자에게 반환되는 문서는 자식이 아닌 **부모 문서**이다.

이 과정을 통해 시스템은 정보의 정밀성과 문맥의 풍부함을 동시에 확보할 수 있다.

## 의미 기반 분할과의 관계

부모-자식 분할은 의미 기반 분할을 대체하는 것이 아니다. 오히려 상호 보완적이다. 예를 들어 자식 청크를 나눌 때 의미 단위 분할을 적용하면, 더 자연스럽고 응답 품질이 높은 결과를 유도할 수 있다.


## 예시 코드

```python
import os
from dotenv import load_dotenv
from docx import Document as DocxDocument
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.retrievers import ParentDocumentRetriever
from langchain.storage import InMemoryStore

# 1. 환경 변수 로드
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise EnvironmentError("OPENAI_API_KEY가 .env에 설정되지 않았습니다.")

# 2. 문서 로딩 함수
def load_docx_as_text(path: str) -> str:
    doc = DocxDocument(path)
    return "\n".join([para.text.strip() for para in doc.paragraphs if para.text.strip()])

# 3. 원본 문서 로드
docx_path = "data/26. 플래티어 가이드북_2025_최신_250610.docx"
raw_text = load_docx_as_text(docx_path)
raw_documents = [Document(
    page_content=raw_text,
    metadata={"source": docx_path, "title": "플래티어 가이드북"}
)]

# 4. 분할기 정의
parent_splitter = RecursiveCharacterTextSplitter(
    chunk_size=2000,
    chunk_overlap=200,
    separators=["\n\n", "\n", "▶", "01 ", "02 ", "03 ", "04 ", "05 ", "06 ", "07 ", "08 ", "09 ", " ", ""]
)

child_splitter = RecursiveCharacterTextSplitter(
    chunk_size=400,
    chunk_overlap=50,
    separators=["\n\n", "\n", "▶", " ", ""]
)

# 5. 임베딩 및 벡터스토어 초기화
embedding = OpenAIEmbeddings(openai_api_key=api_key)
vectorstore = FAISS.from_texts(["dummy"], embedding=embedding)
vectorstore.delete([vectorstore.index_to_docstore_id[0]])
store = InMemoryStore()

# 6. ParentDocumentRetriever 설정
retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=store,
    parent_splitter=parent_splitter,
    child_splitter=child_splitter,
    k=4
)

# 7. 색인 수행
retriever.add_documents(raw_documents)

# 8. 간단한 검색 테스트
query = "5년마다 주는 휴가는 무엇인가요?"
results = retriever.invoke(query)

print(f"\n[검색 결과] 쿼리: '{query}'")
print(f"총 {len(results)}개의 결과가 반환되었습니다.\n")

for i, doc in enumerate(results, 1):
    print(f"[결과 {i}]")
    print(f"내용 (앞 200자): {doc.page_content[:200].strip()}")
    print(f"메타데이터: {doc.metadata}")
    print("-" * 50)
```


여기서 `separators`는 `RecursiveCharacterTextSplitter`가 텍스트를 **청크(chunk)** 로 나눌 때 **우선적으로 사용하는 구분자들**을 의미한다.

### 작동 단계

1. 가장 먼저 `\n\n` 으로 텍스트를 분할하려 시도한다.  
    이 구분자로 나눈 결과가 각 청크마다 100자 이하라면 그대로 사용한다.  
    아니라면 다음 단계로 넘어간다.
    
2. `\n` 으로 분할하려 시도한다.  
    이 경우도 마찬가지로, 각 청크가 적절한 크기이면 사용하고, 그렇지 않으면 다음 단계로 진행한다.
    
3. `.` (마침표)로 분할을 시도한다. 이는 문장 단위 분할을 의미한다.
    
4. 여전히 원하는 크기로 나눌 수 없다면 `" "` (공백)을 기준으로 분할한다. 이는 단어 단위 분할에 해당한다.
    
5. 마지막으로 `""` (빈 문자열)을 사용해 문자 단위로 강제로 잘라낸다. 이 경우는 의미 있는 경계 없이 무조건 길이에 맞춰 자르는 방식이다.
