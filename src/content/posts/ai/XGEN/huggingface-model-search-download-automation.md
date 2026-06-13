---
title: HuggingFace 모델 검색 및 다운로드 자동화
description: XGEN 모델 서버에서 HuggingFace Hub API로 모델을 검색하고, 백그라운드로 다운로드하며 진행상황을 추적하는
  DownloadService 구현과 xgen-app(Tauri)과의 연동
pubDatetime: 2026-01-25
tags:
- HuggingFace
- 모델 다운로드
- FastAPI
- Tauri
- XGEN
- 모델 관리
- AI
---


LLM 서빙 서버에 모델을 올리려면 먼저 모델을 서버에 가져와야 한다. 처음엔 수동으로 `huggingface-cli download`를 쳤지만, 사용자가 UI에서 직접 모델을 검색하고 다운로드하는 기능이 필요했다. xgen-model에 HuggingFace 모델 검색/다운로드 API를 붙인 과정을 정리한다.

## 배경

xgen-app은 Tauri로 만든 데스크톱 앱으로, 로컬 LLM 서버를 GUI로 관리하는 도구다. 사용자가 모델명을 검색하면 HuggingFace Hub에서 결과를 받아오고, 선택하면 서버에서 다운로드가 시작된다.

```
# 커밋: HuggingFace 모델 검색 API 엔드포인트 추가
# 날짜: 2026-01-25 09:10
```

## HuggingFace 검색 API

```python
@router.get("/search")
async def search_models(
    query: str,
    limit: int = 20,
    filter_type: str = "text-generation",  # 또는 "feature-extraction"
):
    """HuggingFace Hub 모델 검색"""
    from huggingface_hub import HfApi
    api = HfApi()

    models = api.list_models(
        search=query,
        task=filter_type,
        limit=limit,
        sort="downloads",
        direction=-1,
    )

    return {
        "results": [
            {
                "model_id": m.modelId,
                "downloads": m.downloads,
                "likes": m.likes,
                "tags": m.tags,
                "last_modified": str(m.lastModified),
            }
            for m in models
        ]
    }
```

`task` 파라미터로 LLM(`text-generation`)과 임베딩 모델(`feature-extraction`)을 구분해서 검색한다. `sort="downloads"`로 다운로드 수 기준으로 정렬한다.

## DownloadService: 백그라운드 다운로드

```python
class DownloadService:
    def __init__(
        self,
        models_dir: str,
        max_retries: int = 3,
        retry_delays: list[float] = None,
        max_workers: int = 2,
    ):
        self.models_dir = Path(models_dir)
        self.max_retries = max_retries
        self.retry_delays = retry_delays or [1.0, 5.0, 30.0]
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._downloads: dict[str, DownloadInfo] = {}
```

다운로드는 `ThreadPoolExecutor`로 백그라운드에서 실행한다. HuggingFace Hub의 다운로드가 동기 블로킹이기 때문에 스레드풀을 사용한다.

```python
@router.post("/download")
async def download_model(request: Request, payload: DownloadRequest):
    """모델 다운로드 시작 (백그라운드)"""
    download_svc = request.app.state.download_service

    # 백그라운드 태스크로 다운로드 시작
    download_id = await download_svc.start_download(
        model_id=payload.model_id,
        filename=payload.filename,  # GGUF 파일명 (None이면 자동)
    )

    return {"download_id": download_id, "status": "started"}
```

## 다운로드 진행상황 추적

```python
@dataclass
class DownloadInfo:
    model_id: str
    status: str  # "downloading", "completed", "failed"
    progress: float = 0.0  # 0.0 ~ 1.0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: str | None = None
    local_path: str | None = None

@router.get("/download/{download_id}/status")
async def get_download_status(request: Request, download_id: str):
    """다운로드 진행상황 조회"""
    download_svc = request.app.state.download_service
    info = download_svc.get_download_info(download_id)
    if not info:
        raise HTTPException(status_code=404, detail="Download not found")
    return info
```

클라이언트(xgen-app)가 폴링으로 진행상황을 확인한다. `progress`가 1.0이 되면 완료다.

## HuggingFace Hub 다운로드

```python
from huggingface_hub import hf_hub_download, snapshot_download

async def _download_model(self, model_id: str, filename: str | None):
    """실제 다운로드 수행"""
    loop = asyncio.get_event_loop()

    if filename:
        # GGUF 파일 단일 다운로드
        local_path = await loop.run_in_executor(
            self._executor,
            lambda: hf_hub_download(
                repo_id=model_id,
                filename=filename,
                local_dir=str(self.models_dir / model_id.replace("/", "--")),
                token=os.getenv("HF_TOKEN"),
            )
        )
    else:
        # 전체 레포 다운로드 (HF 포맷)
        local_path = await loop.run_in_executor(
            self._executor,
            lambda: snapshot_download(
                repo_id=model_id,
                local_dir=str(self.models_dir / model_id.replace("/", "--")),
                token=os.getenv("HF_TOKEN"),
                ignore_patterns=["*.msgpack", "*.h5", "flax_model*"],
            )
        )
    return local_path
```

GGUF 파일은 `hf_hub_download`로 단일 파일만, HuggingFace safetensors 모델은 `snapshot_download`로 전체를 받는다. `ignore_patterns`으로 불필요한 파일(JAX/TensorFlow 포맷)은 제외한다.

## 모델 메타데이터 조회

```
# 커밋: HuggingFace 모델 검색 API 엔드포인트 추가
# 날짜: 2026-01-25 09:10
```

모델 상세 정보(파일 목록, 크기, 양자화 종류 등)를 조회하는 API도 필요했다. GGUF 모델의 경우 Q4_K_M, Q5_K_S 등 여러 양자화 파일이 있기 때문이다.

```python
@router.get("/model-info")
async def get_model_info(model_id: str):
    """HuggingFace 모델 파일 목록 및 메타데이터 조회"""
    from huggingface_hub import HfApi
    api = HfApi()

    model_info = api.model_info(model_id)
    siblings = model_info.siblings or []

    gguf_files = [
        {
            "filename": s.rfilename,
            "size": s.size,
            "lfs": s.lfs is not None,
        }
        for s in siblings
        if s.rfilename.endswith(".gguf")
    ]

    return {
        "model_id": model_id,
        "gguf_files": gguf_files,
        "safetensors_files": [
            s.rfilename for s in siblings if s.rfilename.endswith(".safetensors")
        ],
        "tags": model_info.tags,
        "config": model_info.config,
    }
```

xgen-app은 이 API로 GGUF 파일 목록을 받아서 사용자에게 양자화 옵션을 선택하게 한다.

## HfFileSystemResolveError 처리

```
# 커밋: HfFileSystemResolveError import 제거
# 날짜: 2026-01-26 00:10
```

`huggingface_hub` 버전에 따라 `HfFileSystemResolveError`가 없는 경우가 있었다. import 시 `AttributeError`가 발생해서 이 예외 클래스를 직접 참조하는 코드를 제거했다.

```python
# 변경 전: 특정 예외 클래스 import
from huggingface_hub.errors import HfFileSystemResolveError

# 변경 후: 일반 예외로 처리
try:
    result = hf_hub_download(...)
except Exception as e:
    if "resolve" in str(e).lower():
        raise ValueError(f"Model not found: {model_id}") from e
    raise
```

라이브러리 버전 의존성을 줄이는 방향이 맞다.

## 모델 삭제 (언인스톨)

```python
@router.post("/uninstall")
async def uninstall_model(request: Request, payload: UninstallModelRequest):
    """모델 삭제 (언로드 + 파일 삭제)"""
    pm = request.app.state.process_manager
    download_svc = request.app.state.download_service

    # 1. 로드된 상태면 언로드
    if payload.model_name in pm.loaded_models:
        await pm.unload_model(payload.model_name)

    # 2. 파일 삭제
    if payload.delete_files:
        download_svc.delete_local_model(model_path)

    return {"status": "success", "unloaded": True, "files_deleted": files_deleted}
```

언로드와 파일 삭제를 하나의 API로 묶었다. UI에서 "모델 삭제" 버튼 하나로 두 작업을 처리한다.

## 실전에서 배운 것

HuggingFace 다운로드는 느리다. 70B 모델의 GGUF Q4_K_M은 40GB 정도인데, 네트워크 속도에 따라 수십 분이 걸린다. 이 동안 UI가 멈추면 안 되니 백그라운드 처리는 필수다.

`snapshot_download`의 `ignore_patterns`는 생각보다 효과적이다. Llama 계열 모델의 경우 `.msgpack`(Flax), `.h5`(TensorFlow) 파일이 safetensors 파일과 함께 올라와 있는데, 이걸 제외하면 다운로드 크기가 크게 줄어든다.

HF_TOKEN을 환경변수로 관리하는 게 중요하다. gated 모델(Llama, Mistral 등)은 토큰이 없으면 다운로드가 안 된다. Dockerfile에서 `--build-arg HF_TOKEN`으로 주입하거나, 런타임에 환경변수로 전달해야 한다.
