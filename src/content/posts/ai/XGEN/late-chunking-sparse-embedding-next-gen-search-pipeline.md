---
title: 'Late Chunking과 Sparse Embedding: 차세대 검색 파이프라인'
description: xgen-workflow에서 Late Chunking 기법으로 문서 컨텍스트를 보존하는 청킹과, Sparse Embedding을
  결합한 차세대 RAG 검색 파이프라인 설계 및 구현
pubDatetime: 2026-01-05
tags:
- Late Chunking
- Sparse Embedding
- RAG
- 임베딩
- XGEN
- AI
---


# Late Chunking과 Sparse Embedding: 차세대 검색 파이프라인

전통적인 RAG 파이프라인은 문서를 먼저 청킹하고, 각 청크를 독립적으로 임베딩한다. 이 방식의 문제는 청킹 이후 컨텍스트가 손실된다는 것이다. "3장에서 설명한 개념"이라는 청크는 3장이 어디인지 모르면 검색이 안 된다. Late Chunking은 이 문제를 해결한다.

## Late Chunking이란

Late Chunking은 임베딩을 먼저 하고 청킹을 나중에 한다. 전체 문서(또는 큰 섹션)를 모델에 한 번에 넣어 토큰 레벨 임베딩을 얻고, 그 임베딩을 청크 경계에 따라 풀링(mean pooling)해서 청크 임베딩을 만든다.

```
전통적 방식:
  문서 → 청킹 → [청크1, 청크2, ...] → 각각 임베딩 → 벡터 저장

Late Chunking:
  문서 → 전체 임베딩 (토큰 레벨) → 청킹 경계 적용 → 풀링 → 벡터 저장
```

```
# 커밋 (xgen-workflow): Late Chunking, Sparse Embedding 파이프라인 추가
# 시기: 2026.01
```

## 토큰 레벨 임베딩과 청크 풀링

```python
class LateChunkingPipeline:
    def __init__(self, embedding_client, chunk_size=512, overlap=50):
        self.embedding_client = embedding_client
        self.chunk_size = chunk_size
        self.overlap = overlap

    async def embed_with_context(
        self,
        document: str,
        chunk_boundaries: List[Tuple[int, int]]
    ) -> List[List[float]]:
        """
        전체 문서를 임베딩한 뒤 청크 경계에서 풀링

        Args:
            document: 전체 문서 텍스트
            chunk_boundaries: [(start_char, end_char), ...] 청크 경계
        """
        # 1. 전체 문서 토큰화 (모델 컨텍스트 윈도우 제한 내)
        token_embeddings = await self.embedding_client.get_token_embeddings(document)

        # 2. 토큰 위치를 문자 위치로 매핑
        char_to_token = self._build_char_to_token_map(document, token_embeddings)

        # 3. 각 청크 경계에서 mean pooling
        chunk_embeddings = []
        for start_char, end_char in chunk_boundaries:
            start_token = char_to_token.get(start_char, 0)
            end_token = char_to_token.get(end_char, len(token_embeddings))

            chunk_tokens = token_embeddings[start_token:end_token]
            chunk_embedding = self._mean_pool(chunk_tokens)
            chunk_embeddings.append(chunk_embedding)

        return chunk_embeddings

    def _mean_pool(self, token_embeddings: List[List[float]]) -> List[float]:
        """토큰 임베딩의 평균 풀링"""
        if not token_embeddings:
            return [0.0] * self.embedding_dim
        arr = np.array(token_embeddings)
        return arr.mean(axis=0).tolist()
```

전체 문서를 한 번에 임베딩하므로 각 토큰이 문서 전체 컨텍스트를 반영한다. 청크로 나눈 뒤 해당 청크에 속한 토큰들의 임베딩을 평균내면, 컨텍스트가 보존된 청크 임베딩이 만들어진다.

## 컨텍스트 윈도우 제약

Late Chunking의 한계는 모델 컨텍스트 윈도우다. 문서 전체를 한 번에 모델에 넣어야 하는데, 100페이지짜리 문서는 8192 토큰 제한에 걸린다.

실용적인 접근은 섹션 단위로 Late Chunking을 적용하는 것이다. 제목, 소제목 등 구조적 경계를 기준으로 섹션을 나누고, 각 섹션 내에서 Late Chunking을 적용한다.

```python
async def process_document(self, document: str) -> List[ChunkWithEmbedding]:
    # 섹션 분리 (제목 기준)
    sections = self.split_by_sections(document)

    results = []
    for section in sections:
        if len(section) > self.max_tokens:
            # 섹션이 너무 길면 전통적 청킹
            chunks = self.traditional_chunk(section)
            embeddings = await self.embed_independently(chunks)
        else:
            # Late Chunking 적용
            chunk_boundaries = self.get_chunk_boundaries(section)
            embeddings = await self.embed_with_context(section, chunk_boundaries)
            chunks = self.extract_chunks(section, chunk_boundaries)

        results.extend(zip(chunks, embeddings))

    return results
```

## Sparse Embedding 결합

Late Chunking으로 얻은 Dense 임베딩에 BM25 Sparse 임베딩을 결합한다.

```python
async def process_and_store(
    self,
    document: str,
    collection_name: str,
):
    # 1. Late Chunking으로 Dense 임베딩 생성
    chunks_with_dense = await self.late_chunk_pipeline.process_document(document)

    for chunk_text, dense_embedding in chunks_with_dense:
        # 2. BM25 Sparse 임베딩 생성
        sparse_vector = await self.sparse_client.encode_documents([chunk_text])
        sparse_vec = sparse_vector[0].to_qdrant_format()

        # 3. Qdrant에 Dense + Sparse 함께 저장
        await self.vector_manager.upsert_point(
            collection_name=collection_name,
            point_id=str(uuid.uuid4()),
            vector=dense_embedding,           # Dense (Late Chunking)
            sparse_vector={
                "sparse": sparse_vec          # Sparse (BM25)
            },
            payload={"chunk_text": chunk_text, ...}
        )
```

## 검색 시 Late Chunking의 이점

검색 쿼리도 Late Chunking을 적용한다. 쿼리가 짧으면 큰 차이가 없지만, 긴 쿼리("3장에서 설명한 배치 처리 최적화 방법을 찾아줘")에서 컨텍스트가 반영된 임베딩이 더 정확한 결과를 준다.

```python
async def search(self, query: str, collection_name: str, limit: int = 10):
    # Dense 쿼리 임베딩 (Late Chunking은 짧은 쿼리에는 효과 미미)
    dense_query = await self.embedding_client.embed_query(query)

    # BM25 Sparse 쿼리
    sparse_query = await self.sparse_client.encode_query(query)

    # 하이브리드 검색
    return await self.vector_manager.search_hybrid(
        collection_name=collection_name,
        query_vector=dense_query,
        sparse_vector=sparse_query.to_qdrant_format(),
        limit=limit,
    )
```

## 실전 적용 시 고려사항

**토큰화 일관성**: Late Chunking은 임베딩 모델의 토크나이저와 청크 경계가 일치해야 한다. 문자 위치 기반 청킹을 토큰 위치로 정확히 매핑하는 게 구현의 핵심이다.

**배치 크기**: 전체 문서를 한 번에 처리하므로 배치 크기가 커진다. llama-server의 `n_batch=2048` 설정이 여기서 중요하다.

**IDF 학습**: BM25의 IDF는 코퍼스 전체를 보고 계산해야 정확하다. 초기에는 IDF=1.0(균등 가중치)으로 시작하고, 문서가 쌓이면 `fit()`으로 재학습하는 게 좋다.

Late Chunking과 Sparse Embedding의 조합은 아직 성숙 단계다. 실제 도입 효과는 데이터셋에 따라 다르고, 항상 기존 방식보다 좋지는 않다. A/B 테스트를 통해 실제 검색 품질을 측정하고 적용하는 것을 권장한다.
