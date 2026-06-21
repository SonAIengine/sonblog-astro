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
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from synaptic import SynapticGraph

try:
    from kiwipiepy import Kiwi
except Exception:  # pragma: no cover - 운영에서는 설치되어 있지만 로컬 fallback을 허용
    Kiwi = None

EMBED_URL = os.environ.get("EMBED_URL", "http://localhost:8181/v1")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "bge-m3")
RERANK_URL = os.environ.get("RERANK_URL", "http://localhost:8180")
RERANK_MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
INDEX_JSON = os.environ.get(
    "INDEX_JSON",
    os.path.join(os.path.dirname(__file__), "..", "dist", "search-fulltext.json"),
)
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "700"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "120"))
GRAPH_DB = os.environ.get("GRAPH_DB", os.path.join(os.path.dirname(__file__), "blog_graph.db"))
# 리랭커 점수 노이즈 컷 — 이 값 미만은 무관한 글로 보고 제외(최소 1건은 보장)
SCORE_FLOOR = float(os.environ.get("SCORE_FLOOR", "0.4"))
NO_LEXICAL_SCORE_FLOOR = float(os.environ.get("NO_LEXICAL_SCORE_FLOOR", "0.88"))
NO_LEXICAL_MARGIN_FLOOR = float(os.environ.get("NO_LEXICAL_MARGIN_FLOOR", "0.08"))

TOKEN_RE = re.compile(r"[가-힣]{2,}|[a-z0-9][a-z0-9.+#-]*", re.IGNORECASE)
ASCII_RE = re.compile(r"^[a-z0-9][a-z0-9.+#-]*$")
HANGUL_RE = re.compile(r"[가-힣]")
OPERATOR_TOKEN_RE = re.compile(r"\b(AND|OR)\b", re.IGNORECASE)
EQURL_RE = re.compile(r"\bEQURL\s*:\s*(\"[^\"]+\"|'[^']+'|[^\s]+)", re.IGNORECASE)
ENABLE_KOREAN_MORPHOLOGY = os.environ.get("ENABLE_KOREAN_MORPHOLOGY", "true").lower() != "false"
KIWI = Kiwi() if ENABLE_KOREAN_MORPHOLOGY and Kiwi is not None else None
KO_MORPH_TAG_PREFIXES = ("NN", "VV", "VA", "XR")
IMPORTANT_SHORT_KO_TERMS = {"딥"}
QUERY_ALIASES = [
    (re.compile(r"\bdeep\s+learn(?:ing)?\b", re.IGNORECASE), "딥러닝 deep-learning"),
    (re.compile(r"\bdeeplearn(?:ing)?\b", re.IGNORECASE), "딥러닝"),
    (re.compile(r"\bk8s\b", re.IGNORECASE), "kubernetes k3s 쿠버네티스"),
    (re.compile(r"\bargo\s+cd\b", re.IGNORECASE), "argocd argo-cd"),
    (re.compile(r"\bgraph\s+tool\s+call\b", re.IGNORECASE), "graph-tool-call"),
    (re.compile(r"\bllm\s*ops\b", re.IGNORECASE), "llmops"),
    (re.compile(r"\bv\s*llm\b", re.IGNORECASE), "vllm"),
]
DEEP_LEARNING_QUERY_RE = re.compile(
    r"\bdeep\s+learn(?:ing)?\b|\bdeeplearn(?:ing)?\b", re.IGNORECASE
)
GENERIC_QUERY_TERMS = {
    "글",
    "관련",
    "검색",
    "기술",
    "방법",
    "다이어그램",
    "문서",
    "문서를",
    "서비스",
    "소개",
    "정리",
    "프로젝트",
    "대학원",
    "article",
    "blog",
    "diagram",
    "post",
}

state: dict = {"graph": None, "docs": [], "docs_by_url": {}}


def chunk_text(text: str) -> list[str]:
    """전체 본문을 단락(\\n) 기준으로 ~CHUNK_SIZE자 청크로 분할.
    긴 단락은 문자 윈도우(overlap 포함)로 추가 분할한다."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]
    paras = [p.strip() for p in text.split("\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(p) > CHUNK_SIZE:
            if buf:
                chunks.append(buf)
                buf = ""
            i = 0
            step = max(1, CHUNK_SIZE - CHUNK_OVERLAP)
            while i < len(p):
                chunks.append(p[i : i + CHUNK_SIZE])
                i += step
        elif buf and len(buf) + 1 + len(p) > CHUNK_SIZE:
            chunks.append(buf)
            buf = p
        else:
            buf = f"{buf}\n{p}" if buf else p
    if buf:
        chunks.append(buf)
    return chunks


def load_documents() -> list[dict]:
    with open(INDEX_JSON, encoding="utf-8") as f:
        return json.load(f)


def load_chunks(docs: list[dict] | None = None) -> list[dict]:
    """글당 전체 본문을 청크로 분할해 ingest. 같은 글의 청크는 doc_id(=url)로
    묶여 synaptic이 NEXT_CHUNK 그래프를 구성한다. 검색결과는 source=url로 글에 매핑."""
    docs = docs if docs is not None else load_documents()
    chunks = []
    for d in docs:
        url = d["url"]
        title = d["title"]
        cat = d.get("category", "")
        tags = " ".join(d.get("tags", []) or [])
        # 제목·설명·태그 메타 — 첫 청크에 결합해 제목/태그 매칭 가중
        head = "\n".join([title, d.get("description", ""), tags]).strip()
        pieces = chunk_text(d.get("body", "")) or [""]
        for i, piece in enumerate(pieces):
            content = f"{head}\n{piece}".strip() if i == 0 else piece
            chunks.append(
                {
                    "content": content,
                    "title": title,
                    "doc_id": url,
                    "source": url,
                    "category": cat,
                    "chunk_index": i,
                }
            )
    return chunks


def normalize_query(query: str) -> str:
    """오타/띄어쓰기 변형을 검색어 뒤에 보강한다.

    원문을 제거하지 않고 alias를 append하는 방식이라 정확 질의의 의미를 망가뜨리지 않는다.
    """
    normalized = (query or "").strip()
    additions: list[str] = []
    for pattern, replacement in QUERY_ALIASES:
        if pattern.search(normalized):
            additions.append(replacement)
    return " ".join([normalized, *additions]).strip()


def normalize_term(raw: str) -> str:
    return (raw or "").strip("-_.").lower()


def extract_terms(text: str) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for raw in TOKEN_RE.findall(text or ""):
        term = normalize_term(raw)
        if len(term) < 2 or term in GENERIC_QUERY_TERMS or term in seen:
            continue
        seen.add(term)
        terms.append(term)
    return terms


def extract_morph_terms(text: str) -> list[str]:
    if KIWI is None or not text:
        return []

    terms: list[str] = []
    seen: set[str] = set()
    for token in KIWI.tokenize(text):
        tag = getattr(token, "tag", "")
        form = normalize_term(getattr(token, "form", ""))
        if not form or form in seen or form in GENERIC_QUERY_TERMS:
            continue
        if not HANGUL_RE.search(form):
            continue
        if not tag.startswith(KO_MORPH_TAG_PREFIXES):
            continue
        if len(form) < 2 and form not in IMPORTANT_SHORT_KO_TERMS:
            continue
        seen.add(form)
        terms.append(form)
    return terms


def merge_terms(*groups: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for term in group:
            if not term or term in seen:
                continue
            seen.add(term)
            merged.append(term)
    return merged


def lexical_terms(text: str) -> set[str]:
    return set(merge_terms(extract_terms(text), extract_morph_terms(text)))


def should_drop_compound_query_term(term: str, morph_terms: list[str]) -> bool:
    return bool(HANGUL_RE.search(term) and len(term) > 4 and len(morph_terms) >= 2)


def query_terms(query: str, normalized_query: str) -> list[str]:
    regex_terms = extract_terms(normalized_query)
    morph_terms = extract_morph_terms(normalized_query)
    if morph_terms:
        regex_terms = [
            term
            for term in regex_terms
            if not should_drop_compound_query_term(term, morph_terms)
        ]
    terms = merge_terms(regex_terms, morph_terms)
    if DEEP_LEARNING_QUERY_RE.search(query):
        terms = [
            term
            for term in terms
            if term
            not in {
                "deep",
                "learn",
                "learning",
                "deeplearn",
                "deeplearning",
                "딥",
                "러닝",
            }
        ]
        terms = merge_terms(terms, ["딥러닝", "deep-learning"])
    return terms


def canonical_url(value: str) -> str:
    raw = (value or "").strip().strip("\"'")
    if not raw:
        return ""
    raw = raw.split("#", 1)[0].split("?", 1)[0]
    if raw.startswith("http://") or raw.startswith("https://"):
        try:
            raw = "/" + raw.split("://", 1)[1].split("/", 1)[1]
        except IndexError:
            raw = "/"
    if not raw.startswith("/"):
        raw = f"/{raw}"
    path = raw.rstrip("/")
    return f"{path}/" if path else "/"


def parse_query(query: str) -> dict:
    raw = (query or "").strip()
    equrls: list[str] = []

    def capture_equrl(match: re.Match) -> str:
        equrls.append(canonical_url(match.group(1)))
        return " "

    without_equrl = EQURL_RE.sub(capture_equrl, raw)
    operator = "and" if re.search(r"\bAND\b", without_equrl, re.IGNORECASE) else "or"
    semantic_query = OPERATOR_TOKEN_RE.sub(" ", without_equrl)
    semantic_query = re.sub(r"\s+", " ", semantic_query).strip()
    normalized_query = normalize_query(semantic_query)
    terms = query_terms(semantic_query, normalized_query)

    return {
        "raw": raw,
        "operator": operator,
        "equrls": sorted({url for url in equrls if url}),
        "semantic_query": semantic_query,
        "normalized_query": normalized_query,
        "terms": terms,
    }


def searchable_text(doc: dict) -> str:
    return "\n".join(
        [
            str(doc.get("title", "")),
            str(doc.get("description", "")),
            " ".join(doc.get("tags", []) or []),
            str(doc.get("category", "")),
            str(doc.get("body", "")),
        ]
    ).lower()


def prepare_doc_lookup(docs: list[dict]) -> dict[str, dict]:
    prepared: dict[str, dict] = {}
    for doc in docs:
        url = str(doc.get("url", "")).rstrip("/")
        if not url:
            continue
        text = searchable_text(doc)
        title_text = str(doc.get("title", "")).lower()
        tag_text = " ".join(doc.get("tags", []) or []).lower()
        prepared[url] = {
            **doc,
            "_search_text": text,
            "_title_text": title_text,
            "_tag_text": tag_text,
            "_tokens": lexical_terms(text),
            "_title_tokens": lexical_terms(title_text),
            "_tag_tokens": lexical_terms(tag_text),
        }
    return prepared


def term_matches(term: str, doc: dict, field: str = "_search_text") -> bool:
    text = doc.get(field, "")
    token_key = {
        "_search_text": "_tokens",
        "_title_text": "_title_tokens",
        "_tag_text": "_tag_tokens",
    }.get(field, "_tokens")
    token_match = term in doc.get(token_key, set())
    if ASCII_RE.match(term) or field != "_search_text":
        return token_match
    return token_match or term in text


def evidence_features(doc: dict | None, terms: list[str], normalized_query: str) -> dict:
    if not doc or not terms:
        return {
            "matched_terms": [],
            "term_count": len(terms),
            "lexical_ratio": 0.0,
            "title_ratio": 0.0,
            "tag_ratio": 0.0,
            "title_match": False,
            "tag_match": False,
            "exact_phrase": False,
        }

    matched = [term for term in terms if term_matches(term, doc)]
    title_matched = [term for term in terms if term_matches(term, doc, "_title_text")]
    tag_matched = [term for term in terms if term_matches(term, doc, "_tag_text")]
    title_match = bool(title_matched)
    tag_match = bool(tag_matched)
    phrase = (normalized_query or "").strip().lower()
    exact_phrase = bool(len(phrase) >= 4 and phrase in doc.get("_search_text", ""))
    return {
        "matched_terms": matched,
        "term_count": len(terms),
        "lexical_ratio": len(matched) / max(1, len(terms)),
        "title_ratio": len(title_matched) / max(1, len(terms)),
        "tag_ratio": len(tag_matched) / max(1, len(terms)),
        "title_match": title_match,
        "tag_match": tag_match,
        "exact_phrase": exact_phrase,
    }


def rank_score(raw_score: float, features: dict) -> float:
    score = raw_score
    ratio = features["lexical_ratio"]
    if ratio:
        score += min(0.08, ratio * 0.08)
    if features["title_match"]:
        score += 0.04
    if features["tag_match"]:
        score += 0.03
    if features["exact_phrase"]:
        score += 0.04
    return round(min(score, 0.99), 4)


def has_strong_lexical_evidence(features: dict) -> bool:
    matched = features["matched_terms"]
    if not matched:
        return False
    if features["title_match"] or features["tag_match"] or features["exact_phrase"]:
        return True
    if features.get("term_count", 0) >= 3:
        return len(matched) >= 2 and features["lexical_ratio"] >= 0.34
    return any(not (ASCII_RE.match(term) and len(term) <= 2) for term in matched)


def make_candidate(
    *,
    url: str,
    title: str,
    raw_score: float,
    doc: dict | None,
    terms: list[str],
    normalized_query: str,
    source: str,
) -> dict:
    features = evidence_features(doc, terms, normalized_query)
    return {
        "url": url,
        "title": title,
        "score": rank_score(raw_score, features),
        "raw_score": round(raw_score, 4),
        "confidence": "high" if features["matched_terms"] else "semantic",
        "sources": [source],
        **features,
    }


def make_equrl_candidate(doc: dict, terms: list[str], normalized_query: str) -> dict:
    candidate = make_candidate(
        url=str(doc["url"]).rstrip("/"),
        title=doc.get("title", ""),
        raw_score=0.99,
        doc=doc,
        terms=terms,
        normalized_query=normalized_query,
        source="equrl",
    )
    candidate["score"] = 0.99
    candidate["confidence"] = "high"
    candidate["exact_url"] = True
    return candidate


def upsert_candidate(candidates: dict[str, dict], candidate: dict) -> None:
    current = candidates.get(candidate["url"])
    if current is None:
        candidates[candidate["url"]] = candidate
        return

    current["sources"] = sorted(set(current.get("sources", [])) | set(candidate.get("sources", [])))
    if (candidate["score"], candidate["raw_score"]) > (current["score"], current["raw_score"]):
        candidate["sources"] = current["sources"]
        candidates[candidate["url"]] = candidate


def add_equrl_candidates(
    *,
    candidates: dict[str, dict],
    docs_by_url: dict[str, dict],
    plan: dict,
) -> None:
    for url in plan["equrls"]:
        doc = docs_by_url.get(url.rstrip("/"))
        if doc:
            upsert_candidate(
                candidates,
                make_equrl_candidate(doc, plan["terms"], plan["normalized_query"]),
            )


def add_lexical_fallback_candidates(
    *,
    candidates: dict[str, dict],
    docs: list[dict],
    terms: list[str],
    normalized_query: str,
) -> None:
    if not terms:
        return
    for doc in docs:
        features = evidence_features(doc, terms, normalized_query)
        ratio = features["lexical_ratio"]
        if ratio <= 0:
            continue
        if not has_strong_lexical_evidence(features):
            continue
        if ratio < 0.5 and not (features["title_match"] or features["tag_match"]):
            continue
        raw_score = 0.56 + min(0.22, ratio * 0.18)
        candidate = make_candidate(
            url=str(doc["url"]).rstrip("/"),
            title=doc.get("title", ""),
            raw_score=raw_score,
            doc=doc,
            terms=terms,
            normalized_query=normalized_query,
            source="lexical",
        )
        upsert_candidate(candidates, candidate)


def is_confident_candidate(candidate: dict, no_lexical_margin: float) -> bool:
    if candidate.get("exact_url") or "equrl" in candidate.get("sources", []):
        return True
    if candidate["score"] < SCORE_FLOOR:
        return False
    if has_strong_lexical_evidence(candidate):
        return True
    return (
        candidate["raw_score"] >= NO_LEXICAL_SCORE_FLOOR
        and no_lexical_margin >= NO_LEXICAL_MARGIN_FLOOR
    )


def satisfies_query_plan(candidate: dict, plan: dict) -> bool:
    candidate_url = canonical_url(candidate.get("url", ""))
    if plan["equrls"] and candidate_url not in plan["equrls"]:
        return False

    if plan["operator"] == "and" and plan["terms"] and "equrl" not in candidate.get("sources", []):
        return set(plan["terms"]).issubset(set(candidate.get("matched_terms", [])))

    return True


def public_result(candidate: dict) -> dict:
    return {
        "url": candidate["url"] + "/",
        "title": candidate["title"],
        "score": candidate["score"],
        "confidence": candidate["confidence"],
        "sources": candidate["sources"],
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    docs = load_documents()
    prepared_docs = prepare_doc_lookup(docs)
    chunks = load_chunks(docs)
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
    state["docs"] = list(prepared_docs.values())
    state["docs_by_url"] = prepared_docs
    print(f"[blog-search] ready: {len(chunks)} docs indexed")
    # 리랭커/임베더/연결 워밍업 — 첫 사용자 쿼리의 콜드 스타트(수십 초) 제거
    try:
        await graph.search("워밍업 테스트 검색", limit=3, engine="evidence", rerank=False)
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
    return {
        "ok": state["graph"] is not None,
        "morphology": "kiwipiepy" if KIWI is not None else "disabled",
        "docs": len(state.get("docs", [])),
    }


@app.get("/search")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(12, ge=1, le=40),
    # 리랭커(bge-reranker, GPU)는 이 코퍼스에서 품질 향상이 미미한데 GPU 경합 시
    # 지연 스파이크(수 초)를 유발 → 기본 끔. dense(bge-m3)+BM25+PPR로 충분.
    # 필요 시 ?rerank=true 로 켤 수 있음.
    rerank: bool = False,
):
    graph = state["graph"]
    if graph is None:
        return {"query": q, "results": [], "error": "not ready"}
    plan = parse_query(q)
    normalized_q = plan["normalized_query"]
    terms = plan["terms"]
    docs = state.get("docs", [])
    docs_by_url = state.get("docs_by_url", {})
    # 청크 단위로 더 받아서 글(url) 단위로 합침
    r = None
    candidates: dict[str, dict] = {}
    if normalized_q:
        r = await graph.search(normalized_q, limit=limit * 4, engine="evidence", rerank=rerank)
        for an in r.nodes:
            n = an.node
            url = str(n.source or (n.properties or {}).get("url") or "").rstrip("/")
            if not url:
                continue
            doc = docs_by_url.get(url)
            candidate = make_candidate(
                url=url,
                title=(n.properties or {}).get("title") or n.title,
                raw_score=float(an.activation),
                doc=doc,
                terms=terms,
                normalized_query=normalized_q,
                source="synaptic",
            )
            upsert_candidate(candidates, candidate)

    add_equrl_candidates(
        candidates=candidates,
        docs_by_url=docs_by_url,
        plan=plan,
    )

    if normalized_q:
        add_lexical_fallback_candidates(
            candidates=candidates,
            docs=docs,
            terms=terms,
            normalized_query=normalized_q,
        )

    ranked = sorted(
        candidates.values(),
        key=lambda item: (
            item["score"],
            item["title_ratio"],
            item["tag_ratio"],
            item["exact_phrase"],
            item["raw_score"],
            item["lexical_ratio"],
            item["title"],
        ),
        reverse=True,
    )
    top_raw = ranked[0]["raw_score"] if ranked else 0.0
    second_raw = ranked[1]["raw_score"] if len(ranked) > 1 else 0.0
    no_lexical_margin = top_raw - second_raw
    results = [
        public_result(candidate)
        for candidate in ranked
        if satisfies_query_plan(candidate, plan)
        and is_confident_candidate(candidate, no_lexical_margin)
    ][:limit]

    stages = list(r.stages_used) if r is not None else []
    if normalized_q and normalized_q != plan["semantic_query"]:
        stages.append("query_normalized")
    if KIWI is not None and terms:
        stages.append("korean_morphology")
    if plan["operator"] == "and":
        stages.append("operator_and")
    else:
        stages.append("operator_or")
    if plan["equrls"]:
        stages.append("equrl_filter")
    if any("lexical" in result.get("sources", []) for result in results):
        stages.append("lexical_fallback")
    stages.append("doc_rank")
    stages.append("confidence_gate")

    return {
        "query": q,
        "normalizedQuery": normalized_q,
        "operator": plan["operator"],
        "equrls": plan["equrls"],
        "results": results,
        "stages": stages,
        "ms": round(r.search_time_ms if r is not None else 0, 1),
    }
