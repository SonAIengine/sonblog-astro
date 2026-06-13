---
title: pyproject.toml dependencies 추출로 Docker 빌드 레이어 캐시 최적화
description: requirements.txt 없는 pyproject.toml 프로젝트에서 Docker 레이어 캐시를 최대한 활용하기 위해
  의존성만 선별 추출하는 방법
pubDatetime: 2026-02-04
tags:
- Docker
- Python
- pyproject.toml
- Poetry
- DevOps
- 빌드 최적화
- 도커
- 레이어 캐시
---


## 배경

Python 프로젝트가 `requirements.txt` 대신 `pyproject.toml`로 의존성을 관리하는 방식이 늘었다. Poetry, PDM, Hatch 등 모던 Python 패키지 매니저가 모두 pyproject.toml을 사용한다.

문제는 Docker 빌드다. 전통적인 레이어 캐시 전략은 이렇다:

```dockerfile
COPY requirements.txt .
RUN pip install -r requirements.txt  # ← 이 레이어가 캐시됨
COPY . .                             # 소스코드 변경 시 위 레이어 재사용
```

`requirements.txt`를 먼저 COPY하면, 소스코드가 바뀌어도 의존성 레이어는 캐시를 재사용한다.

그런데 pyproject.toml은 의존성 외에 프로젝트 메타데이터, 빌드 설정, 개발 도구 설정까지 담고 있다. `pyproject.toml` 전체를 먼저 COPY하면 `.pre-commit-config.yaml` 하나 바뀌어도 pip 설치 레이어가 무효화된다.

## xgen-core의 pyproject.toml 구조

```toml
# xgen-core/pyproject.toml
[tool.poetry]
name = "xgen-core"
version = "0.1.0"
description = "XGEN 2.0 Core Service"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.104.0"
uvicorn = {extras = ["standard"], version = "^0.24.0"}
sqlalchemy = "^2.0.0"
asyncpg = "^0.29.0"
httpx = "^0.25.0"
pydantic = "^2.4.0"
pydantic-settings = "^2.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.0"
pytest-asyncio = "^0.21.0"
black = "^23.0.0"

[tool.ruff]
line-length = 120
```

여기서 Docker 빌드에 필요한 것은 `[tool.poetry.dependencies]` 섹션뿐이다. dev dependencies나 ruff 설정이 바뀌어도 pip 설치 레이어는 무효화되면 안 된다.

## 의존성 추출 스크립트

```dockerfile
# # 커밋: pyproject.toml에서 dependencies만 추출해 Docker 레이어 캐시 최적화
# # 날짜: 2024-09-20

FROM python:3.11-slim as deps-extractor

WORKDIR /tmp

COPY pyproject.toml .

# tomli로 pyproject.toml 파싱, dependencies만 추출
RUN pip install --quiet tomli && python3 -c "
import tomli, sys

with open('pyproject.toml', 'rb') as f:
    data = tomli.load(f)

deps = data.get('tool', {}).get('poetry', {}).get('dependencies', {})

lines = []
for name, spec in deps.items():
    if name == 'python':
        continue
    if isinstance(spec, str):
        # fastapi = '^0.104.0' → fastapi>=0.104.0,<0.105.0
        lines.append(f'{name}{spec.replace(\"^\", \">=0.\")}')
    elif isinstance(spec, dict):
        # uvicorn = {extras = [\"standard\"], version = \"^0.24.0\"}
        version = spec.get('version', '')
        extras = spec.get('extras', [])
        extras_str = f'[{\",\".join(extras)}]' if extras else ''
        lines.append(f'{name}{extras_str}{version.replace(\"^\", \">=0.\")}')

with open('/tmp/requirements.txt', 'w') as f:
    f.write('\n'.join(lines))
" && cat /tmp/requirements.txt
```

`tomli`는 Python 3.11 미만에서 TOML 파싱에 필요한 라이브러리다. Python 3.11부터는 `tomllib`이 표준 라이브러리에 포함돼 있다.

## 전체 Dockerfile

```dockerfile
# Dockerfile (xgen-core)
FROM python:3.11-slim as deps-extractor

WORKDIR /tmp
COPY pyproject.toml .

RUN pip install --quiet tomli && python3 -c "
import tomli
with open('pyproject.toml', 'rb') as f:
    data = tomli.load(f)
deps = data.get('tool', {}).get('poetry', {}).get('dependencies', {})
lines = []
for name, spec in deps.items():
    if name == 'python':
        continue
    if isinstance(spec, str):
        ver = spec.replace('^', '>=').replace('~', '~=')
        lines.append(f'{name}{ver}')
    elif isinstance(spec, dict):
        version = spec.get('version', '').replace('^', '>=').replace('~', '~=')
        extras = spec.get('extras', [])
        extras_str = f'[{\",\".join(extras)}]' if extras else ''
        lines.append(f'{name}{extras_str}{version}')
with open('/tmp/requirements.txt', 'w') as f:
    f.write('\n'.join(lines))
"

FROM python:3.11-slim as runner

WORKDIR /app

# deps-extractor에서 requirements.txt만 가져옴
COPY --from=deps-extractor /tmp/requirements.txt .

# 의존성 설치 (pyproject.toml 변경 안 되면 캐시 유지)
RUN pip install --no-cache-dir -r requirements.txt

# 소스코드는 나중에 COPY
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
```

소스코드가 바뀌어도 `pyproject.toml`의 dependencies 섹션이 바뀌지 않았다면 `pip install` 레이어는 캐시를 재사용한다.

## python3-dev 삽질

추출 스크립트 실행 중 예상치 못한 에러가 발생했다.

```bash
# # 커밋: deps-extractor에 python3-dev 추가 (tomli 빌드 실패 해결)
# # 날짜: 2024-09-21

# 에러 내용
error: command '/usr/bin/gcc' failed with exit code 1
note: This error originates from a subprocess, and is likely not a problem with pip.
Building wheel for tomli (pyproject.toml)
```

`tomli` 설치 시 네이티브 컴파일이 필요한데 `gcc`와 `python3-dev`가 없어서 실패했다. `python:3.11-slim` 이미지는 컴파일 도구가 없다.

```dockerfile
# 해결: 빌드 도구 설치
FROM python:3.11-slim as deps-extractor
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev && \
    rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
RUN pip install --quiet tomli && python3 -c "..."
```

나중에 알고 보니 `tomli`는 순수 Python으로도 설치 가능한 wheel이 있는데 `python:3.11-slim`의 pip가 오래된 버전이라 소스 빌드를 시도했던 것이다.

```dockerfile
# 더 나은 해결책: pip 먼저 업그레이드
RUN pip install --upgrade pip && pip install --quiet tomli
```

pip를 최신 버전으로 올리면 `tomli`의 바이너리 wheel을 찾아서 컴파일 없이 설치한다.

## Python 3.11 표준 라이브러리 활용

Python 3.11 이상이면 `tomllib`이 내장돼 있어 별도 설치가 불필요하다.

```dockerfile
# # 커밋: python3.11 tomllib 사용으로 tomli 의존성 제거
# # 날짜: 2024-09-22
FROM python:3.11-slim as deps-extractor

WORKDIR /tmp
COPY pyproject.toml .

RUN python3 -c "
import tomllib

with open('pyproject.toml', 'rb') as f:
    data = tomllib.load(f)

deps = data.get('tool', {}).get('poetry', {}).get('dependencies', {})
lines = []
for name, spec in deps.items():
    if name == 'python':
        continue
    if isinstance(spec, str):
        ver = spec.replace('^', '>=').replace('~', '~=')
        lines.append(f'{name}{ver}')
    elif isinstance(spec, dict):
        version = spec.get('version', '').replace('^', '>=').replace('~', '~=')
        extras = spec.get('extras', [])
        extras_str = f'[{\",\".join(extras)}]' if extras else ''
        lines.append(f'{name}{extras_str}{version}')

with open('/tmp/requirements.txt', 'w') as f:
    f.write('\n'.join(lines))
print('Generated requirements.txt:')
with open('/tmp/requirements.txt') as f:
    print(f.read())
"
```

`tomllib`은 Python 3.11 표준 라이브러리라 별도 설치 없이 import 가능하다. `python:3.11-slim` 이미지에서 gcc/python3-dev도 필요 없다.

## 캐시 효과 비교

| 시나리오 | pyproject.toml 전체 COPY | 의존성 추출 방식 |
|---------|--------------------------|----------------|
| 소스코드만 변경 | pip 캐시 **무효** | pip 캐시 **유지** |
| dev dependency 변경 | pip 캐시 **무효** | pip 캐시 **유지** |
| linting 설정 변경 | pip 캐시 **무효** | pip 캐시 **유지** |
| 실제 dependency 변경 | pip 캐시 무효 | pip 캐시 무효 |

일상적인 개발에서 소스코드나 개발 도구 설정만 바꾸는 경우가 훨씬 많다. 이런 경우 의존성 추출 방식이 pip install 레이어를 캐시하므로 빌드 시간이 크게 단축된다.

## 결과

- pyproject.toml dependencies만 선별 추출 → pip install 레이어 캐시 최적화
- xgen-core 소스코드 변경 시 빌드 시간: ~3분 → ~30초
- Python 3.11 tomllib로 외부 의존성 없이 구현
- pip upgrade로 gcc/python3-dev 불필요

pyproject.toml이 requirements.txt보다 편리하지만 Docker 레이어 캐시 측면에서는 불리하다. 의존성만 추출하는 패턴을 쓰면 이 단점을 극복할 수 있다.
