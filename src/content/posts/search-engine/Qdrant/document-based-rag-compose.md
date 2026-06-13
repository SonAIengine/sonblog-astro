---
title: “Qdrant + FastAPI 문서 기반 RAG 파이프라인 구현”
description: “FastAPI와 Qdrant를 활용한 문서 기반 RAG 파이프라인 예제를 정리한다. 파일 업로드부터 확장자별 로더, 청킹,
  Qdrant 벡터 색인, Dense/Sparse/Hybrid 검색까지 전 과정을 다룬다.”
pubDatetime: 2025-07-16
tags:
- Qdrant
- 벡터검색
- 검색엔진
- RAG
- FastAPI
- Python
- Search Engine
---


아래는 FastAPI를 이용해 “파일 업로드 → 로드(확장자별) → 청크(split) → Qdrant에 색인(index) → 검색(일반·희소·하이브리드)”까지 전 과정을 보여주는 예제 코드이다.

```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from tempfile import TemporaryDirectory
from pathlib import Path
from typing import List
import uvicorn

from langchain.document_loaders import (
    TextLoader,
    PyPDFLoader,
    UnstructuredWordDocumentLoader,
    UnstructuredPowerPointLoader,
    UnstructuredMarkdownLoader,
)
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_qdrant import QdrantVectorStore, RetrievalMode, FastEmbedSparse
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, SparseVectorParams, Filter, FieldCondition, MatchValue
from langchain_core.documents import Document

app = FastAPI()

# 1) 임베딩 & Qdrant 클라이언트 설정
OPENAI_API_KEY = "YOUR_OPENAI_API_KEY"
QDRANT_URL = "http://localhost:6333"
COLLECTION = "uploaded_docs"

# dense, sparse embedding 인스턴스
dense_embed = OpenAIEmbeddings(model="text-embedding-3-small", api_key=OPENAI_API_KEY)
sparse_embed = FastEmbedSparse(model_name="Qdrant/bm25")

# Qdrant 클라이언트
client = QdrantClient(url=QDRANT_URL)
# 컬렉션 생성 (없으면)
if not client.collection_exists(COLLECTION):
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config={"dense": VectorParams(size=dense_embed.dim, distance=Distance.COSINE)},
        sparse_vectors_config={"sparse": SparseVectorParams(index=models.SparseIndexParams(on_disk=False))},
    )

# 2) 파일 → Document 로더 선택 함수
def load_document(path: Path) -> List[Document]:
    suffix = path.suffix.lower()
    if suffix == ".txt":
        loader = TextLoader(str(path), encoding="utf-8")
    elif suffix in {".pdf"}:
        loader = PyPDFLoader(str(path))
    elif suffix in {".docx", ".doc"}:
        loader = UnstructuredWordDocumentLoader(str(path))
    elif suffix in {".pptx", ".ppt"}:
        loader = UnstructuredPowerPointLoader(str(path))
    elif suffix in {".md", ".markdown"}:
        loader = UnstructuredMarkdownLoader(str(path))
    else:
        raise ValueError(f"지원하지 않는 파일 확장자: {suffix}")
    return loader.load()

# 3) 텍스트 청크(split)
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200
)

# 4) 색인 함수
def index_documents(docs: List[Document]):
    # 모든 청크 생성
    chunks = []
    for doc in docs:
        chunks += text_splitter.split_documents([doc])
    # Qdrant VectorStore
    store = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION,
        embedding=dense_embed,
        sparse_embedding=sparse_embed,
        retrieval_mode=RetrievalMode.HYBRID,
        vector_name="dense",
        sparse_vector_name="sparse",
    )
    # bulk upsert
    ids = store.add_documents(documents=chunks)
    return ids

# 5) 업로드 엔드포인트
@app.post("/upload")
async def upload(files: List[UploadFile] = File(...)):
    try:
        all_docs = []
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for f in files:
                dest = tmp_path / f.filename
                content = await f.read()
                dest.write_bytes(content)
                all_docs += load_document(dest)
        ids = index_documents(all_docs)
        return JSONResponse({"indexed_ids": ids, "count": len(ids)})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# 6) 검색 엔드포인트
@app.get("/search")
def search(
    q: str,
    mode: str = "hybrid",  # 'dense', 'sparse', 'hybrid'
    k: int = 3,
    filter_text: str = None
):
    # 적절한 RetrievalMode 및 VectorStore 선택
    mode = mode.lower()
    if mode == "dense":
        store = QdrantVectorStore(client, COLLECTION, embedding=dense_embed,
                                  retrieval_mode=RetrievalMode.DENSE, vector_name="dense")
        results = store.similarity_search(q, k=k)
    elif mode == "sparse":
        store = QdrantVectorStore(client, COLLECTION, sparse_embedding=sparse_embed,
                                  retrieval_mode=RetrievalMode.SPARSE, sparse_vector_name="sparse")
        results = store.similarity_search(q, k=k)
    elif mode == "hybrid":
        store = QdrantVectorStore(client, COLLECTION, embedding=dense_embed, sparse_embedding=sparse_embed,
                                  retrieval_mode=RetrievalMode.HYBRID, vector_name="dense", sparse_vector_name="sparse")
        # 메타필터 예제
        flt = None
        if filter_text:
            flt = Filter(should=[FieldCondition(
                key="page_content",
                match=MatchValue(value=filter_text)
            )])
        # 점수까지 반환
        results = store.similarity_search_with_score(q, k=k, filter=flt)
    else:
        raise HTTPException(status_code=400, detail="mode는 dense, sparse, hybrid 중 하나여야 합니다.")
    # 반환 포맷
    return JSONResponse({
        "mode": mode,
        "query": q,
        "results": [
            {"text": d.page_content, "score": float(s) if isinstance(s, (int, float)) else None}
            for d, s in (results if mode=="hybrid" else [(d, None) for d in results])
        ]
    })

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```


**설명 정리**

1. **파일 업로드**(`/upload`)
    
    - 다양한 확장자(`.txt`, `.pdf`, `.docx`, `.pptx`, `.md`) 지원
        
    - 임시 디렉터리에 저장 후 각 로더로 `Document` 객체 생성
        
2. **청크(split)**
    
    - `RecursiveCharacterTextSplitter`로 `chunk_size=1000`, `overlap=200` 설정
        
3. **색인(index)**
    
    - `RetrievalMode.HYBRID`로 컬렉션에 dense+sparse 벡터 함께 저장
        
4. **검색**(`/search`)
    
    - `mode=dense|sparse|hybrid` 옵션
        
    - hybrid 모드 시 score 반환, optional metadata 필터링 지원

---

**관련 글**

- [LangChain과 Qdrant 통합 — Dense, Sparse, Hybrid 검색 구현](langchain-qdrant.md): LangChain의 `QdrantVectorStore`를 사용한 다양한 검색 모드 설정과 메타데이터 필터링
- [Qdrant LangChain — Retriever와 VectorStore 활용법](qdrant-langchain.md): Retriever 변환, 커스텀 payload 키 설정, 기존 컬렉션 연결 등 심화 활용법


