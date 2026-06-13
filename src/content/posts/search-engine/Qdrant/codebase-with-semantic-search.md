---
title: Qdrant로 코드베이스 시맨틱 검색 구현하기
description: Qdrant를 활용해 코드베이스에 시맨틱 검색을 적용하는 방법을 정리한다. 자연어 질의용 sentence-transformers와
  코드 유사도 검색용 jina-embeddings-v2-base-code 모델을 활용한 듀얼 임베딩 전략을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- 시맨틱검색
- 코드검색
- 임베딩
- Search Engine
---


### 1. 목표 및 접근 방식

1. **자연어 질의 → 시맨틱 검색**
    
    - 일반 문장용 임베딩 모델: `sentence-transformers/all-MiniLM-L6-v2`
        
2. **코드 ↔ 코드 유사도 검색**
    
    - 코드 특화 임베딩 모델: `jinaai/jina-embeddings-v2-base-code`
        
3. **코드 정제**
    
    - 자연어 모델을 위해 함수 · 구조체 시그니처, 주석, 모듈 정보를 문장 형태로 변환
        
    - 코드 특화 모델은 원본 코드를 그대로 사용
        
4. **Qdrant 컬렉션**
    
    - `text` 벡터 공간과 `code` 벡터 공간을 동시에 저장
        
5. **질의 시나리오**
    
    - 사용자 질의를 두 모델로 모두 임베딩 → 각각 상위 k개 스니펫 검색
        
    - 필요 시 결과를 병합하거나 그룹핑하여 다양성과 정확도를 향상

### 2. 소스 코드 파싱 · 청크 분할

|단계|내용|
|---|---|
|**LSIF 추출**|`rust-analyzer`를 이용해 LSP → LSIF 포맷으로 내보냄|
|**청크 정의**|함수·메서드·struct·enum 등 언어 단위별로 분할|
|**JSON 문서화**|코드, 시그니처, docstring, 모듈·파일 경로, 행 번호 등을 포함|

예시 JSON 항목

```json
{
  "name": "await_ready_for_timeout",
  "signature": "fn await_ready_for_timeout(&self, timeout: Duration) -> bool",
  "code_type": "Function",
  "docstring": "Return `true` if ready, `false` if timed out.",
  "line_from": 43,
  "line_to": 51,
  "context": {
    "module": "common",
    "file_name": "is_ready.rs",
    "struct_name": "IsReady",
    "snippet": "/// Return `true` if ready ... }"
  }
}
```


### 3. 자연어 변환 함수 `textify`

1. **표기 정규화**
    
    - CamelCase → snake_case → 자연어 형태
        
2. **주석·docstring 포함**
    
3. **템플릿 조합**
    
    ```python
    "Function await ready for timeout defined as fn … in struct Is ready module common file is_ready rs"
    ```
    
4. **특수문자 제거** 후 공백으로 연결
    


### 4. Qdrant 컬렉션 생성 및 업로드

```python
from qdrant_client import QdrantClient, models

client = QdrantClient("http://localhost:6333")   # 또는 클라우드 URL+API Key

client.create_collection(
    "qdrant-sources",
    vectors_config={
        "text": models.VectorParams(
            size=client.get_embedding_size("sentence-transformers/all-MiniLM-L6-v2"),
            distance=models.Distance.COSINE
        ),
        "code": models.VectorParams(
            size=client.get_embedding_size("jinaai/jina-embeddings-v2-base-code"),
            distance=models.Distance.COSINE
        )
    }
)
```

업로드 예시

```python
points = [
    models.PointStruct(
        id=uuid.uuid4().hex,
        vector={
            "text":  models.Document(text=text_repr, model="sentence-transformers/all-MiniLM-L6-v2"),
            "code":  models.Document(text=code_src,  model="jinaai/jina-embeddings-v2-base-code")
        },
        payload=meta_dict
    )
    for text_repr, code_src, meta_dict in zip(text_reprs, code_snippets, structures)
]

client.upload_points("qdrant-sources", points=points, batch_size=64)
```

`qdrant-client[fastembed]` 패키지가 Document 객체를 자동으로 임베딩하여 전송한다.


### 5. 질의 및 결과 병합

#### 5.1 단일 모델 검색

```python
query = "How do I count points in a collection?"

hits_text = client.query_points(
    "qdrant-sources",
    query=models.Document(text=query, model="sentence-transformers/all-MiniLM-L6-v2"),
    using="text",
    limit=5
).points

hits_code = client.query_points(
    "qdrant-sources",
    query=models.Document(text=query, model="jinaai/jina-embeddings-v2-base-code"),
    using="code",
    limit=5
).points
```

#### 5.2 배치 쿼리로 동시 검색

```python
responses = client.query_batch_points(
    "qdrant-sources",
    requests=[
        models.QueryRequest(
            query=models.Document(text=query, model="sentence-transformers/all-MiniLM-L6-v2"),
            using="text", limit=5, with_payload=True
        ),
        models.QueryRequest(
            query=models.Document(text=query, model="jinaai/jina-embeddings-v2-base-code"),
            using="code", limit=5, with_payload=True
        ),
    ],
)
# responses[0].points + responses[1].points -> 결과 후처리
```

#### 5.3 모듈 단위 그룹핑

```python
grouped = client.query_points_groups(
    collection_name="qdrant-sources",
    query=models.Document(text=query, model="jinaai/jina-embeddings-v2-base-code"),
    using="code",
    group_by="context.module",
    limit=5, group_size=1
)
```


### 6. 웹 데모 동작 흐름

1. 사용자가 자연어 질의 입력
    
2. **두 모델 병렬 임베딩**
    
3. `text` 5건 + `code` 20건 검색
    
4. 결과 중복·겹침 스니펫 병합
    
5. 프런트엔드에서 코드 하이라이트 표시
    

### 7. 정리 및 권장 사항

- **청크 크기**: 함수·메서드 등 논리 단위로 나누어야 컨텍스트 손실이 적다.
    
- **모델 이중화**: 자연어 모델은 시그니처·주석 기반 매칭에 강하고, 코드 모델은 로직 유사도에 강하다.
    
- **결과 후처리**:
    
    - 랭킹 합산, 중복 제거, 그룹핑으로 다양성과 정확도를 조정한다.
        
    - UI에서 코드 위치(파일·행 번호)와 스니펫을 함께 표기하면 탐색성이 높아진다.
        
- **성능**: FastEmbed 내장 인퍼런스는 CPU 병렬화가 가능하나, 프로세스 수가 과하면 스왑이 발생할 수 있으므로 주의가 필요하다.