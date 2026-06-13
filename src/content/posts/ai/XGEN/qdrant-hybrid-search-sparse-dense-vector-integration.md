---
title: 'Qdrant 하이브리드 검색: Sparse + Dense 벡터 통합'
description: xgen-retrieval에서 Qdrant의 Prefetch+Fusion API로 BM25 Sparse Vector와 Dense
  Embedding을 결합하는 하이브리드 검색 구현, Full-Text Index 추가, 컬렉션 설정까지
pubDatetime: 2025-12-29
tags:
- Qdrant
- 하이브리드검색
- Sparse Vector
- BM25
- RAG
- XGEN
- 벡터검색
- AI
---


# Qdrant 하이브리드 검색: Sparse + Dense 벡터 통합

Dense 임베딩만으로 검색하면 키워드 매칭에 약하다. "Python 3.12의 타입 힌트 문법"을 검색할 때 "파이썬 타입 어노테이션"은 잡지만 "3.12"라는 버전 숫자는 놓칠 수 있다. 반대로 BM25 같은 키워드 검색은 의미론적 유사성을 못 잡는다. xgen-retrieval에서 두 가지를 결합하는 하이브리드 검색을 구현한 과정을 정리한다.

## Qdrant의 하이브리드 검색 API

Qdrant는 `Prefetch + Fusion` 방식으로 하이브리드 검색을 공식 지원한다.

```python
from qdrant_client.models import (
    SparseVectorParams, SparseIndexParams, SparseVector,
    NamedSparseVector,
    TextIndexParams, TextIndexType, TokenizerType,
    Prefetch, FusionQuery, Fusion
)
```

`Prefetch`는 여러 검색 결과를 사전 수집하고, `Fusion`은 Reciprocal Rank Fusion(RRF) 알고리즘으로 결합한다.

```
# 커밋: feat: Implement sparse vector and full-text index support in retrieval system
# 날짜: 2025-12-29 14:96

# 커밋: feat: Update vector search method to use query_points with enhanced options
# 날짜: 2026-01-02 00:52
```

## 컬렉션 생성: Sparse + Dense 동시 지원

```python
def create_collection(
    self,
    collection_name: str,
    vector_size: int,
    distance: str = "Cosine",
    enable_sparse_vector: bool = False,
    sparse_vector_name: str = "sparse",
    enable_full_text: bool = False,
    full_text_field: str = "chunk_text",
):
    # Sparse Vector 설정
    sparse_vectors_config = None
    if enable_sparse_vector:
        sparse_vectors_config = {
            sparse_vector_name: SparseVectorParams(
                index=SparseIndexParams(on_disk=False)  # RAM에 인덱스 유지
            )
        }

    # 컬렉션 생성
    self.client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=vector_size,
            distance=Distance.COSINE
        ),
        sparse_vectors_config=sparse_vectors_config,
    )

    # Full-Text Index 추가 (생성 후)
    if enable_full_text:
        self._create_full_text_index(collection_name, full_text_field)
```

Dense Vector(`vectors_config`)와 Sparse Vector(`sparse_vectors_config`)를 함께 설정한다. `on_disk=False`로 sparse 인덱스를 RAM에 올려서 검색 속도를 높였다.

## Full-Text Index 생성

```python
def _create_full_text_index(self, collection_name: str, field: str = "chunk_text"):
    """Full-Text Index 생성 (BM25 기반 텍스트 검색용)"""
    self.client.create_payload_index(
        collection_name=collection_name,
        field_name=field,
        field_schema=TextIndexParams(
            type=TextIndexType.TEXT,
            tokenizer=TokenizerType.WORD,   # 단어 단위 토큰화
            min_token_len=2,                # 최소 2글자
            max_token_len=15,               # 최대 15글자
            lowercase=True,                 # 소문자 정규화
        )
    )
```

Qdrant의 Full-Text Index는 payload 필드에 만들 수 있다. 한국어는 `WORD` 토크나이저로 공백 기준 분리를 기본으로 한다.

## BM25 Sparse 클라이언트

외부 SPLADE 모델 없이 BM25로 sparse vector를 직접 계산한다.

```python
class BM25SparseClient:
    def __init__(self, config: Dict[str, Any] = None):
        self.k1 = config.get("k1", 1.5)   # 단어 빈도 포화 파라미터
        self.b = config.get("b", 0.75)    # 문서 길이 정규화 파라미터
        self.avg_doc_length = config.get("avg_doc_length", 256)
        self.vocab: Dict[str, int] = {}   # 동적 어휘 사전
        self.idf: Dict[str, float] = {}

    def _compute_bm25_weights(self, tokens: List[str]) -> Dict[int, float]:
        doc_length = len(tokens)
        term_freqs = Counter(tokens)
        weights = {}

        for term, tf in term_freqs.items():
            token_id = self._get_or_create_token_id(term)
            # BM25 TF 계산
            tf_component = (tf * (self.k1 + 1)) / (
                tf + self.k1 * (1 - self.b + self.b * doc_length / self.avg_doc_length)
            )
            idf = self.idf.get(term, 1.0)  # IDF (fit 전: 1.0 기본값)
            weights[token_id] = tf_component * idf

        return weights
```

한글, 영문, 숫자를 각각 추출하는 토크나이저를 사용한다.

```python
def _tokenize(self, text: str) -> List[str]:
    text = text.lower()
    tokens = re.findall(r'[가-힣]+|[a-zA-Z]+|[0-9]+', text)
    return tokens
```

## RAGService에서 BM25 초기화

```python
class RAGService:
    def __init__(self, config_composer, embedding_client=None, ...):
        # BM25 Sparse Embedding Client 초기화
        from service.embedding.bm25_sparse_client import BM25SparseClient
        self.sparse_embedding_client = BM25SparseClient(config={
            "k1": 1.5,
            "b": 0.75,
            "avg_doc_length": 256
        })
```

`avg_doc_length=256`은 청크 평균 길이(토큰 기준)를 의미한다. 실제 코퍼스에 맞게 조정하면 더 정확하지만, 초기값으로 256을 사용했다.

## search_hybrid: Prefetch + Fusion

```python
def search_hybrid(
    self,
    collection_name: str,
    query_vector: List[float],
    sparse_vector: Dict[str, List] = None,
    limit: int = 10,
    sparse_vector_name: str = "sparse",
    fusion_method: str = "rrf",
):
    """Hybrid Search: Dense + Sparse, Prefetch + RRF Fusion"""
    prefetch_queries = []

    # 1. Dense Vector Prefetch
    prefetch_queries.append(
        Prefetch(
            query=query_vector,
            limit=limit * 2,  # 최종 limit의 2배 수집
        )
    )

    # 2. Sparse Vector Prefetch (BM25)
    if sparse_vector:
        prefetch_queries.append(
            Prefetch(
                query=NamedSparseVector(
                    name=sparse_vector_name,
                    vector=SparseVector(
                        indices=sparse_vector["indices"],
                        values=sparse_vector["values"],
                    )
                ),
                limit=limit * 2,
            )
        )

    # 3. Fusion (RRF)
    results = self.client.query_points(
        collection_name=collection_name,
        prefetch=prefetch_queries,
        query=FusionQuery(fusion=Fusion.RRF),
        limit=limit,
        with_payload=SEARCH_PAYLOAD_FIELDS,
    ).points
```

RRF(Reciprocal Rank Fusion)는 두 랭킹을 결합하는 알고리즘이다. 각 결과의 순위에 `1/(k + rank)` 가중치를 주어 합산한다. Dense와 Sparse 검색에서 모두 상위에 있는 결과가 최종적으로 높은 점수를 받는다.

## 유효하지 않은 포인트 필터링

```
# 커밋: feat: Add filtering for invalid points in vector search payload
# 날짜: 2026-01-02 00:44

# 커밋: feat: Refine vector search payload handling and metadata filtering
# 날짜: 2026-01-02 00:46
```

컬렉션 메타데이터 포인트가 검색 결과에 섞여 들어오는 문제가 있었다.

```python
for hit in search_results:
    payload = hit.payload or {}

    # 메타데이터 포인트 제거 (컬렉션 설명 등)
    if payload.get("type") == "collection_metadata":
        continue

    # 빈 페이로드 제거
    if not payload.get("file_name") or not payload.get("chunk_text"):
        continue

    results.append({...})
```

`type == "collection_metadata"`인 포인트는 컬렉션 설명을 저장하는 특수 포인트라 검색 결과에서 제외한다.

## 검색 결과 구조

```python
SEARCH_PAYLOAD_FIELDS = [
    "document_id",
    "chunk_index",
    "chunk_text",
    "file_name",
    "file_path",
    "file_type",
    "page_number",
    "type",
    "directory_full_path",
]
```

`with_payload`를 전체 페이로드가 아닌 필요한 필드만 지정해서 네트워크 전송량을 줄였다.

## 실전 성능

정확한 A/B 테스트 수치는 없지만, 주관적인 체감으로:

- **Dense only**: 의미론적 검색에 강함. "머신러닝 기반 이상 탐지"를 검색하면 "AI 기반 anomaly detection"도 찾아줌
- **Sparse only (BM25)**: 키워드 검색에 강함. 코드 변수명, 버전 번호, 고유명사 등
- **Hybrid (RRF)**: 두 장점을 결합. 특히 기술 문서 검색에서 개선이 눈에 띔

BM25의 `avg_doc_length`를 실제 코퍼스 평균에 맞추면 키워드 매칭 점수가 더 정확해진다. 256은 일반 문서 기준이고, 코드 청크가 많으면 더 낮게, 긴 문서 청크가 많으면 더 높게 조정하는 게 좋다.
