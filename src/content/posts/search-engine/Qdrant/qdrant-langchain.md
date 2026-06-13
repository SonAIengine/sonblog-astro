---
title: Qdrant + LangChain 연동 — 벡터 스토어와 Retriever 설정 가이드
description: langchain-qdrant 모듈로 Qdrant를 LangChain 벡터 스토어로 활용하는 방법을 정리한다. Dense/Sparse/Hybrid
  검색 설정, 메타데이터 필터링, Retriever 변환, 임베딩 모델 연동을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- LangChain
- 벡터검색
- 검색엔진
- Retriever
- Python
- Search Engine
---


## 1. 개요

Qdrant는 벡터 유사도 검색을 위한 엔진으로, 고성능의 검색 기능과 편리한 API를 제공한다. 벡터 데이터 외에도 JSON 기반의 payload와 확장된 필터링 기능을 제공하므로, 의미 기반 검색(semantic search)이나 facet 검색, 추천 시스템 등 다양한 애플리케이션에 활용할 수 있다.

LangChain은 Qdrant를 위한 통합 모듈인 `langchain-qdrant`를 통해 밀접하게 연동할 수 있으며, 임베딩 기반 검색(dense), 희소 벡터 검색(sparse), 하이브리드 검색(hybrid retrieval)을 모두 지원한다. 이 문서는 Qdrant를 LangChain에서 효과적으로 활용하는 방법을 정리한 것이다.


## 2. 설치

다음 명령어로 필요한 라이브러리를 설치한다.

```bash
pip install -qU langchain-qdrant
pip install -qU langchain-openai
```


## 3. 임베딩 설정

OpenAI 기반 임베딩 모델을 설정한다. 예시는 `text-embedding-3-large` 모델을 사용하는 경우이다.

```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(model="text-embedding-3-large")
```


## 4. Qdrant 초기화

### (1) 인메모리 모드

테스트 및 실험 용도로는 Qdrant 서버 없이 인메모리 모드로 실행할 수 있다.

```python
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

client = QdrantClient(":memory:")
client.create_collection(
    collection_name="demo_collection",
    vectors_config=VectorParams(size=3072, distance=Distance.COSINE),
)
```

### (2) 온디스크 모드

로컬 디스크에 데이터를 저장하도록 설정할 수 있다.

```python
client = QdrantClient(path="/tmp/langchain_qdrant")
```


## 5. LangChain Vector Store 구성

Qdrant 인스턴스를 LangChain의 `QdrantVectorStore`에 연결한다.

```python
from langchain_qdrant import QdrantVectorStore

vector_store = QdrantVectorStore(
    client=client,
    collection_name="demo_collection",
    embedding=embeddings,
)
```


## 6. 문서 삽입 및 삭제

LangChain의 `Document` 클래스를 사용하여 데이터를 삽입할 수 있다.

```python
from langchain_core.documents import Document
from uuid import uuid4

documents = [
    Document(page_content="문장 A", metadata={"source": "test"}),
    Document(page_content="문장 B", metadata={"source": "test"})
]

uuids = [str(uuid4()) for _ in range(len(documents))]

vector_store.add_documents(documents=documents, ids=uuids)
```

삭제는 다음과 같이 수행한다.

```python
vector_store.delete(ids=[uuids[0]])
```


## 7. 벡터 검색

### (1) 기본 유사도 검색

```python
results = vector_store.similarity_search("LangChain 관련 프로젝트", k=2)
for doc in results:
    print(doc.page_content, doc.metadata)
```

### (2) 유사도 점수 포함 검색

```python
results = vector_store.similarity_search_with_score("내일 날씨", k=1)
for doc, score in results:
    print(f"SIM={score:.3f} | {doc.page_content}")
```


## 8. 검색 모드 구성

### (1) Dense Vector 검색

```python
from langchain_qdrant import RetrievalMode

qdrant = QdrantVectorStore(
    client=client,
    collection_name="my_documents",
    embedding=embeddings,
    retrieval_mode=RetrievalMode.DENSE,
)
```

### (2) Sparse Vector 검색

```python
from langchain_qdrant import FastEmbedSparse
from qdrant_client.http.models import SparseVectorParams

sparse_embeddings = FastEmbedSparse(model_name="Qdrant/bm25")

client.create_collection(
    collection_name="my_documents",
    vectors_config={"dense": VectorParams(size=3072, distance=Distance.COSINE)},
    sparse_vectors_config={
        "sparse": SparseVectorParams(index={"on_disk": False})
    }
)

qdrant = QdrantVectorStore(
    client=client,
    collection_name="my_documents",
    sparse_embedding=sparse_embeddings,
    retrieval_mode=RetrievalMode.SPARSE,
    sparse_vector_name="sparse",
)
```

### (3) Hybrid 검색

```python
qdrant = QdrantVectorStore(
    client=client,
    collection_name="my_documents",
    embedding=embeddings,
    sparse_embedding=sparse_embeddings,
    retrieval_mode=RetrievalMode.HYBRID,
    vector_name="dense",
    sparse_vector_name="sparse",
)
```


## 9. 메타데이터 필터링

Qdrant는 JSON 기반의 payload에 대한 조건 검색을 지원한다. LangChain에서도 이를 사용할 수 있다.

```python
from qdrant_client import models

results = vector_store.similarity_search(
    query="축구 선수",
    k=1,
    filter=models.Filter(
        should=[
            models.FieldCondition(
                key="metadata.source",
                match=models.MatchValue(value="website")
            )
        ]
    ),
)
```


## 10. Retriever로 변환

QdrantVectorStore를 LangChain Retriever로 변환하여 chain이나 agent에서 사용할 수 있다.

```python
retriever = vector_store.as_retriever(search_type="mmr", search_kwargs={"k": 1})
results = retriever.invoke("도둑이 훔친 돈은 얼마인가?")
```


## 11. 기존 Collection 사용

이미 생성된 Collection을 사용할 경우 다음처럼 불러올 수 있다.

```python
qdrant = QdrantVectorStore.from_existing_collection(
    embedding=embeddings,
    collection_name="my_documents",
    url="http://localhost:6333"
)
```


## 12. Named Vector, Custom Payload 키 사용

Qdrant는 하나의 point에 여러 개의 named vector를 저장할 수 있다. 또한, `page_content`와 `metadata` 키 대신 커스텀 필드를 사용할 수도 있다.

```python
QdrantVectorStore.from_documents(
    docs,
    embeddings,
    location=":memory:",
    collection_name="my_documents",
    content_payload_key="custom_content",
    metadata_payload_key="custom_meta",
    vector_name="my_vector",
    sparse_vector_name="my_sparse"
)
```


## 13. 정리

Qdrant는 LangChain과 완벽하게 통합되며, 다양한 검색 모드와 메타데이터 필터링, 점수 기반 검색 등을 유연하게 지원한다. 서버 기반 또는 로컬 기반으로 실행할 수 있고, 기존 Collection의 재사용 또한 가능하다. Retrieval-Augmented Generation (RAG)을 구축하는 데 매우 적합한 벡터 검색 스토어이다.