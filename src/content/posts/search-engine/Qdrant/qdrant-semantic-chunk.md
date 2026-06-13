---
title: “Qdrant를 위한 Semantic Chunking — 임베딩 기반 문서 분할”
description: “Qdrant에 저장할 문서를 의미적으로 분할하는 Semantic Chunking 방법을 정리한다. 문장 임베딩 유사도로 청크
  경계를 결정하고, 고정 길이 분할 대비 검색 정확도를 높이는 구현 방법을 다룬다.”
pubDatetime: 2025-07-16
tags:
- Qdrant
- 시맨틱검색
- 벡터검색
- 검색엔진
- 청킹
- 임베딩
- Search Engine
---


대표적인 방법은 문장을 단위로 나눈 뒤, 각 문장의 임베딩(벡터)을 계산해 “의미적으로 유사한” 문장들을 하나의 청크로 묶는 방식입니다. 

아래 예시는 OpenAIEmbeddings를 이용해 간단한 semantic chunking 함수를 구현하고, 기존 고정 길이 청크 대신 적용하는 방법을 보여줍니다.

```python
import nltk
import numpy as np
from nltk.tokenize import sent_tokenize
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings

nltk.download('punkt')  # 최초 1회만

# 1) 임베딩 객체 (기존 설정 그대로 재사용)
embedder = OpenAIEmbeddings(
    model="text-embedding-3-small",
    api_key="YOUR_OPENAI_API_KEY",
)

def semantic_chunk(text: str,
                   embedder: OpenAIEmbeddings,
                   threshold: float = 0.75
                  ) -> list[str]:
    """
    1) 문장 단위로 분할
    2) 각 문장 임베딩 계산
    3) 순차적으로 유사도가 threshold 이상이면 같은 청크에 추가,
       아니면 새 청크로 분리
    """
    sents = sent_tokenize(text)
    embs = embedder.embed_documents(sents)  # 문장별 벡터 리스트

    chunks = []
    curr_sents, curr_embs = [], []
    for sent, emb in zip(sents, embs):
        if not curr_sents:
            curr_sents, curr_embs = [sent], [emb]
        else:
            avg_emb = np.mean(curr_embs, axis=0)
            sim = np.dot(emb, avg_emb) / (np.linalg.norm(emb) * np.linalg.norm(avg_emb))
            if sim >= threshold:
                curr_sents.append(sent)
                curr_embs.append(emb)
            else:
                chunks.append(" ".join(curr_sents))
                curr_sents, curr_embs = [sent], [emb]
    if curr_sents:
        chunks.append(" ".join(curr_sents))

    return chunks

# ──────────────────────────────────────────────────────────────
# 기존 청크 코드 대신 이 semantic_chunk를 적용

from langchain.document_loaders import TextLoader
from qdrant_client import QdrantClient
from qdrant_client.http.models import VectorParams, SparseVectorParams, Distance
from langchain_qdrant import QdrantVectorStore, RetrievalMode, FastEmbedSparse

# (1) 문서 로드
loader = TextLoader("example.pdf")  
docs = loader.load()  # Page 단위 Document 리스트

# (2) 의미 기반 청크 생성
semantic_docs = []
for doc in docs:
    chunks = semantic_chunk(doc.page_content, embedder, threshold=0.70)
    for chunk in chunks:
        semantic_docs.append(
            Document(page_content=chunk, metadata=doc.metadata)
        )

# (3) Qdrant에 색인
client = QdrantClient(url="http://localhost:6333")
store = QdrantVectorStore(
    client=client,
    collection_name="my_semantic_docs",
    embedding=embedder,
    sparse_embedding=FastEmbedSparse(model_name="Qdrant/bm25"),
    retrieval_mode=RetrievalMode.HYBRID,
    vector_name="dense",
    sparse_vector_name="sparse",
)
store.add_documents(documents=semantic_docs)
```

**요약**

1. **문장별 분할**: `nltk.sent_tokenize` 등을 이용해 문장 리스트로 분리
    
2. **문장 임베딩**: `embedder.embed_documents(sentences)` 호출
    
3. **유사도 기반 묶기**: 이전 청크의 평균 임베딩과 새 문장 벡터 간 cosine 유사도 비교해, threshold 이상이면 같은 청크에 포함
    
4. **Qdrant 색인**: 기존처럼 `QdrantVectorStore.add_documents`에 semantic 청크를 넘겨주면 끝
    

이렇게 하면 “고정 토큰 수”가 아니라 “의미적으로 일관된” 단위로 문서를 분할해서 색인할 수 있습니다.


# 장점과 단점

## 장점

1. **의미적 일관성 유지**
    
    - 의미 단위(문장·절·개념)로 묶기 때문에 한 청크 안의 내용이 주제적으로 응집되어 있다.
        
    - LLM이나 벡터 검색 엔진이 “한 덩어리의 의미”를 보다 명확히 파악할 수 있어, 검색·유사도 평가·요약 정확도가 향상된다.
        
2. **중요 정보 손실 최소화**
    
    - fixed-length splitting은 문장 중간을 자를 수 있어 문장이 분절되거나 핵심 어구가 잘릴 위험이 있다.
        
    - semantic chunking은 문장 경계(또는 의미 단위) 단위로 묶으므로, 맥락이 끊기지 않는다.
        
3. **유연한 청크 크기**
    
    - 내용이 단순한 부분은 한 청크가 작게, 복잡한 부분은 더 길게 자동 조정되어 저장·처리 효율을 높인다.
        
    - 유사도 계산 시에도 “불필요한 패딩”이나 “빈 공간”이 줄어들어 벡터 차원의 낭비가 감소한다.
        
4. **검색 품질 개선**
    
    - 의미적으로 응집된 단위로 벡터를 만들면, 키워드가 분산되지 않아 BM25 같은 sparse 검색에서도 더 높은 정확도를 기대할 수 있다.
        
    - Hybrid 검색 시 dense·sparse 벡터가 모두 통일된 의미 단위로 정렬되므로, 결과의 일관성과 다양성이 향상된다.

## 단점

1. **추가 계산 비용**
    
    - 문장 토크나이저(Punkt, spaCy 등)로 분할 후, 각 문장에 대해 임베딩을 계산해야 하므로 API 호출 횟수·연산량이 크게 늘어난다.
        
    - 전체 문서에 문장 수만큼 벡터 연산을 수행하므로, 고정 길이 청크 대비 지연(latency)과 비용이 상승한다.
        
2. **파라미터 튜닝 복잡성**
    
    - 유사도 임계값(threshold), 문장 그룹화 로직 등 하이퍼파라미터를 적절히 설정해야 한다.
        
    - threshold가 너무 높으면 청크가 작게 쪼개지고(과도 분할), 낮으면 묶음이 과도해져(과다 병합) 의미 집중도가 떨어질 수 있다.
        
3. **변동하는 청크 크기**
    
    - 청크 길이가 고정되지 않아, Q&A나 LLM 체인에 넘길 때 토큰 수 관리가 어렵다.
        
    - 예측 불가능한 길이로 인해 한 번에 처리할 수 있는 컨텍스트 크기를 초과할 위험이 있다.
        
4. **임베딩 품질 의존성**
    
    - semantic chunking의 핵심은 임베딩의 품질에 달려 있다.
        
    - 임베딩 모델 성능이 낮거나 도메인과 맞지 않으면, 유사도 계산 자체가 부정확해져 오히려 잘못된 청크가 생성될 수 있다.