---
title: 벡터DB 컬렉션 문서 요약 및 페이지네이션 API 설계
description: Qdrant scroll() API로 컬렉션 내 문서를 페이지네이션하고, document_id 기준으로 그룹핑해 디렉토리 트리용
  요약 엔드포인트를 설계한 과정
pubDatetime: 2025-12-26
tags:
- Qdrant
- RAG
- 페이지네이션
- Python
- FastAPI
- 벡터DB
- AI
---


## 배경

XGEN의 RAG 시스템은 Qdrant 컬렉션에 문서를 청크 단위로 저장한다. 하나의 PDF가 수십~수백 개의 청크로 분리되어 각각 독립적인 포인트로 저장된다.

프론트엔드에서 두 가지 뷰가 필요했다.

첫째는 **문서 목록 뷰** — 사용자가 컬렉션에 어떤 문서가 있는지 확인하고 삭제하거나 관리하는 화면이다. 수백 개의 청크를 그대로 보여주는 게 아니라 원본 파일 단위로 그룹핑해서 보여줘야 한다. 문서가 많으면 페이지네이션도 필요하다.

둘째는 **디렉토리 트리 뷰** — 컬렉션 내 문서들을 폴더 구조로 시각화하는 사이드바다. 여기서는 전체 문서 목록을 빠르게 가져와야 하는데, 청크 내용까지 다 가져오면 너무 무겁다.

두 용도에 맞게 각각 다른 엔드포인트를 설계했다.

## Qdrant 데이터 구조

```python
# 하나의 포인트(청크) payload 예시
{
    "document_id": "abc123",          # 원본 파일 식별자
    "file_name": "기술보고서.pdf",
    "file_path": "reports/2025/기술보고서.pdf",
    "chunk_index": 3,
    "chunk_total": 47,
    "content": "청크 텍스트 내용...",
    "created_at": "2025-12-20T10:00:00Z"
}
```

`document_id`가 원본 파일 단위의 그룹핑 키다. 같은 파일에서 나온 청크는 모두 같은 `document_id`를 공유한다.

## 페이지네이션 API

### 엔드포인트 설계

```
GET /collections/{collection_name}/documents?page=1&page_size=20
```

```python
# src/controller/retrievalController.py
@router.get("/collections/{collection_name}/documents")
async def list_documents(
    collection_name: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    rag_service: RAGService = Depends(get_rag_service),
):
    result = await rag_service.list_documents_in_collection(
        collection_name=collection_name,
        page=page,
        page_size=page_size,
    )
    return result
```

### Qdrant scroll()로 전체 포인트 순회

Qdrant는 SQL의 `LIMIT OFFSET`처럼 직접 페이지 단위로 건너뛸 수 없다. `scroll()` API로 포인트를 커서 방식으로 순회한 다음, 메모리에서 `document_id`로 그룹핑하고 슬라이싱한다.

```python
# src/service/retrieval/rag_service.py

async def list_documents_in_collection(
    self,
    collection_name: str,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    # 1. scroll()로 전체 포인트 수집 (payload만, 벡터 제외)
    all_points = []
    offset = None

    while True:
        results, next_offset = await self.qdrant_client.scroll(
            collection_name=collection_name,
            scroll_filter=None,
            limit=1000,           # 배치 크기
            offset=offset,
            with_payload=True,
            with_vectors=False,   # 벡터는 필요 없음
        )
        all_points.extend(results)

        if next_offset is None:
            break
        offset = next_offset

    # 2. document_id로 그룹핑
    doc_map: dict[str, dict] = {}
    for point in all_points:
        payload = point.payload or {}
        doc_id = payload.get("document_id")
        if not doc_id:
            continue

        if doc_id not in doc_map:
            doc_map[doc_id] = {
                "document_id": doc_id,
                "file_name": payload.get("file_name", ""),
                "file_path": payload.get("file_path", ""),
                "chunk_count": 0,
                "created_at": payload.get("created_at"),
            }
        doc_map[doc_id]["chunk_count"] += 1

    # 3. 페이지네이션 적용
    doc_list = sorted(
        doc_map.values(),
        key=lambda d: d.get("created_at") or "",
        reverse=True,   # 최신순
    )
    total_docs = len(doc_list)
    total_pages = math.ceil(total_docs / page_size)
    start = (page - 1) * page_size
    end = start + page_size
    page_docs = doc_list[start:end]

    return {
        "documents": page_docs,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total_docs,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }
```

응답 형태:

```json
{
  "documents": [
    {
      "document_id": "abc123",
      "file_name": "기술보고서.pdf",
      "file_path": "reports/2025/기술보고서.pdf",
      "chunk_count": 47,
      "created_at": "2025-12-20T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 83,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  }
}
```

## 요약 API (디렉토리 트리용)

디렉토리 트리는 파일 이름과 경로만 있으면 된다. 청크 카운트나 생성일 같은 추가 정보는 필요 없고, 속도가 중요하다.

```
GET /collections/{collection_name}/documents-summary
```

```python
# src/controller/retrievalController.py
@router.get("/collections/{collection_name}/documents-summary")
async def list_documents_summary(
    collection_name: str,
    rag_service: RAGService = Depends(get_rag_service),
):
    result = await rag_service.list_documents_summary(collection_name)
    return result
```

```python
# src/service/retrieval/rag_service.py

async def list_documents_summary(self, collection_name: str) -> dict:
    all_points = []
    offset = None

    while True:
        results, next_offset = await self.qdrant_client.scroll(
            collection_name=collection_name,
            limit=1000,
            offset=offset,
            with_payload=["document_id", "file_name", "file_path"],  # 필요한 필드만
            with_vectors=False,
        )
        all_points.extend(results)
        if next_offset is None:
            break
        offset = next_offset

    # document_id 기준 deduplication (set 활용)
    seen = set()
    documents = []
    for point in all_points:
        payload = point.payload or {}
        doc_id = payload.get("document_id")
        if doc_id and doc_id not in seen:
            seen.add(doc_id)
            documents.append({
                "document_id": doc_id,
                "file_name": payload.get("file_name", ""),
                "file_path": payload.get("file_path", ""),
            })

    return {
        "documents": documents,
        "total": len(documents),
    }
```

`with_payload=["document_id", "file_name", "file_path"]`로 필요한 필드만 가져오면 네트워크 전송량이 줄어든다. 청크 내용(`content`) 필드가 크기 때문에 이 최적화가 체감된다.

## 성능 고려사항

### scroll() 배치 크기

```python
# 너무 작으면 왕복이 많아짐, 너무 크면 메모리 부담
limit=1000  # 배치당 1000개 포인트
```

컬렉션에 포인트가 10만 개라면 100번 왕복해야 한다. 그러나 실제 RAG 서비스에서 컬렉션 하나에 수만 개 포인트가 들어가는 경우는 드물었다. 문서 1000개 × 평균 50청크 = 5만 포인트 수준에서 2~3초 내에 처리됐다.

### 메모리 그룹핑의 한계

현재 구현은 전체 포인트를 메모리에 올려서 그룹핑한다. 포인트가 수십만 개가 되면 메모리 부담이 커진다. 이 경우는 Qdrant의 `group_by` 기능(Qdrant 1.7+)을 활용하는 게 낫다.

```python
# Qdrant 1.7+ group_by 활용 (미래 개선 방향)
results = await qdrant_client.query_points_groups(
    collection_name=collection_name,
    group_by="document_id",
    limit=20,          # 그룹(문서) 단위 페이지
    group_size=1,      # 그룹당 1개 포인트만
)
```

현재는 컬렉션 규모가 크지 않아서 메모리 그룹핑으로 충분했다.

## 문서 삭제 API

목록을 보여주는 것과 함께, 선택한 문서를 삭제하는 API도 추가했다.

```python
@router.delete("/collections/{collection_name}/documents/{document_id}")
async def delete_document(
    collection_name: str,
    document_id: str,
    rag_service: RAGService = Depends(get_rag_service),
):
    # document_id가 일치하는 포인트 전체 삭제
    await qdrant_client.delete(
        collection_name=collection_name,
        points_selector=FilterSelector(
            filter=Filter(
                must=[
                    FieldCondition(
                        key="document_id",
                        match=MatchValue(value=document_id),
                    )
                ]
            )
        ),
    )
    return {"deleted": document_id}
```

`document_id` 필터로 해당 파일의 모든 청크를 한 번에 삭제한다.

## 결과

- 문서 목록 API: `document_id` 그룹핑 + 페이지네이션으로 청크를 파일 단위로 추상화
- 요약 API: 필요한 필드만 가져와서 디렉토리 트리 렌더링 최적화
- scroll() 오프셋 커서 방식으로 대용량 컬렉션 순회

Qdrant는 SQL처럼 `GROUP BY`나 `OFFSET` 기반 페이지네이션을 직접 지원하지 않는다. 벡터DB의 특성을 이해하고 scroll + 메모리 처리 방식으로 우회하는 게 현실적인 접근이었다.
