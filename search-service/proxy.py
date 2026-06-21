"""SON BLOG search reverse proxy.

Public traffic stays on port 8182. The heavy synaptic backend runs on a
blue/green localhost port, and this proxy reads runtime/active-backend.json on
each request to route to the currently ready backend.
"""

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

STATE_PATH = Path(
    os.environ.get(
        "SEARCH_PROXY_STATE",
        os.path.join(os.path.dirname(__file__), "runtime", "active-backend.json"),
    )
)
DEFAULT_BACKEND = os.environ.get("SEARCH_PROXY_DEFAULT_BACKEND", "http://127.0.0.1:8192")
TIMEOUT_SECONDS = float(os.environ.get("SEARCH_PROXY_TIMEOUT_SECONDS", "20"))
HOP_BY_HOP_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

state: dict = {"client": None}


def load_backend() -> tuple[str, dict]:
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = {"backend": DEFAULT_BACKEND, "source": "default"}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid search proxy state: {STATE_PATH}") from exc

    backend = str(data.get("backend") or "").rstrip("/")
    if not backend:
        port = data.get("port")
        backend = f"http://127.0.0.1:{port}" if port else DEFAULT_BACKEND
    return backend.rstrip("/"), data


def filtered_headers(headers: httpx.Headers) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["client"] = httpx.AsyncClient(
        timeout=httpx.Timeout(TIMEOUT_SECONDS),
        follow_redirects=False,
    )
    yield
    await state["client"].aclose()


app = FastAPI(title="SON BLOG Search Proxy", lifespan=lifespan)


async def fetch_backend(path: str, request: Request) -> Response:
    backend, backend_state = load_backend()
    client: httpx.AsyncClient = state["client"]
    url = f"{backend}/{path.lstrip('/')}"
    try:
        upstream = await client.get(
            url,
            params=request.query_params,
            headers={
                key: value
                for key, value in request.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            },
        )
    except httpx.HTTPError as exc:
        return JSONResponse(
            {
                "ok": False,
                "error": "backend_unavailable",
                "backend": backend,
                "message": str(exc),
                "proxy": {"statePath": str(STATE_PATH), "state": backend_state},
            },
            status_code=503,
        )

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=filtered_headers(upstream.headers),
    )


@app.get("/health")
async def health(request: Request):
    response = await fetch_backend("health", request)
    if response.status_code >= 500:
        return response

    backend, backend_state = load_backend()
    try:
        payload = json.loads(response.body.decode("utf-8"))
    except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
        payload = {"ok": response.status_code < 400}

    payload["proxy"] = {
        "ok": response.status_code < 400,
        "backend": backend,
        "statePath": str(STATE_PATH),
        "state": backend_state,
    }
    status_code = 200 if payload.get("ok") else 503
    return JSONResponse(payload, status_code=status_code)


@app.get("/search")
async def search(request: Request):
    return await fetch_backend("search", request)


@app.get("/{path:path}")
async def passthrough(path: str, request: Request):
    return await fetch_backend(path, request)
