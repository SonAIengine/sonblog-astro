"""블로그 시멘틱 검색 서비스 (synaptic-memory 기반).

정적 블로그(GitHub Pages)가 호출하는 검색 API.
  쿼리 → synaptic EvidenceSearch(BM25 + bge-m3 dense + PPR 그래프 + TEI 리랭커)
  → 글 url + 점수 JSON

구성:
  - 임베딩: TEI bge-m3 (OpenAI 호환 /v1)         EMBED_URL
  - 리랭커: TEI bge-reranker-v2-m3                RERANK_URL
  - 인덱스: 블로그 빌드 산출물 search-index.json   INDEX_JSON

실행: uvicorn app:app --host 0.0.0.0 --port 8182
"""
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from synaptic import SynapticGraph

EMBED_URL = os.environ.get("EMBED_URL", "http://localhost:8181/v1")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "bge-m3")
RERANK_URL = os.environ.get("RERANK_URL", "http://localhost:8180")
RERANK_MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
INDEX_JSON = os.environ.get(
    "INDEX_JSON",
    os.path.join(os.path.dirname(__file__), "..", "dist", "search-index.json"),
)
GRAPH_DB = os.environ.get("GRAPH_DB", os.path.join(os.path.dirname(__file__), "blog_graph.db"))
# 리랭커 점수 노이즈 컷 — 이 값 미만은 무관한 글로 보고 제외(최소 1건은 보장)
SCORE_FLOOR = float(os.environ.get("SCORE_FLOOR", "0.4"))

state: dict = {"graph": None}


def load_chunks() -> list[dict]:
    with open(INDEX_JSON, encoding="utf-8") as f:
        docs = json.load(f)
    chunks = []
    for d in docs:
        tags = d.get("tags", []) or []
        # 제목·태그를 본문 앞에 넣어 FTS/임베딩 가중
        content = "\n".join(
            [d["title"], d.get("description", ""), " ".join(tags), d.get("body", "")]
        ).strip()
        chunks.append(
            {
                "content": content,
                "title": d["title"],
                "source": d["url"],  # 결과에서 node.source 로 회수
                "category": d.get("category", ""),
            }
        )
    return chunks


@asynccontextmanager
async def lifespan(app: FastAPI):
    chunks = load_chunks()
    graph = await SynapticGraph.from_chunks(
        chunks,
        db=GRAPH_DB,
        embed_url=EMBED_URL,
        embed_model=EMBED_MODEL,
        rerank_url=RERANK_URL,
        rerank_backend="tei",
        rerank_model=RERANK_MODEL,
    )
    state["graph"] = graph
    print(f"[blog-search] ready: {len(chunks)} docs indexed")
    # 리랭커/임베더/연결 워밍업 — 첫 사용자 쿼리의 콜드 스타트(수십 초) 제거
    try:
        await graph.search("워밍업 테스트 검색", limit=3, engine="evidence", rerank=True)
        print("[blog-search] warmup done")
    except Exception as e:
        print(f"[blog-search] warmup skipped: {e}")
    yield
    await graph.close()


app = FastAPI(title="SON BLOG Search", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 정적 블로그(여러 오리진)에서 GET만 호출
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": state["graph"] is not None}


@app.get("/search")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(12, ge=1, le=40),
    rerank: bool = True,
):
    graph = state["graph"]
    if graph is None:
        return {"query": q, "results": [], "error": "not ready"}
    # 청크 단위로 더 받아서 글(url) 단위로 합침
    r = await graph.search(q, limit=limit * 3, engine="evidence", rerank=rerank)
    seen: set[str] = set()
    results = []
    for an in r.nodes:
        n = an.node
        url = n.source or (n.properties or {}).get("url")
        if not url or url in seen:
            continue
        # 점수 내림차순 — FLOOR 미만이 나오면 (최소 1건 확보 후) 이하 전부 노이즈로 컷
        if float(an.activation) < SCORE_FLOOR and results:
            break
        seen.add(url)
        results.append(
            {
                "url": url,
                "title": (n.properties or {}).get("title") or n.title,
                "score": round(float(an.activation), 4),
            }
        )
        if len(results) >= limit:
            break
    return {
        "query": q,
        "results": results,
        "stages": r.stages_used,
        "ms": round(r.search_time_ms, 1),
    }
