---
title: RAG Document Loader — .doc/.docx 문서 변환과 파싱
description: LibreOffice CLI로 .doc 파일을 .docx로 변환하고 LangChain Docx2txtLoader로 파싱하는
  파이프라인을 정리한다. 레거시 문서 포맷을 RAG 시스템에 적용하기 위한 전처리 과정을 다룬다.
pubDatetime: 2025-07-17
tags:
- RAG
- 검색엔진
- LangChain
- 문서파싱
- LibreOffice
- Python
- Search Engine
---


많은 기업에서는 여전히 `.doc` 형식의 문서를 사용하거나 보관하고 있다. 

하지만 현대적인 텍스트 처리나 인공지능 기반 문서 분석 시스템에서는 `.docx` 포맷 또는 `.pdf`, `.txt` 형식이 선호된다. 따라서 `.doc` 문서를 자동으로 `.docx`로 변환한 뒤, 그 내용을 파싱 가능한 구조로 불러오는 작업이 필요하다.

본 글에서는 **LibreOffice CLI**를 사용해 `.doc` → `.docx` 변환을 수행하고, **LangChain의 `Docx2txtLoader`**를 이용해 문서 내용을 파싱하는 전 과정을 소개한다.


## 전체 처리 흐름

1. 대상 `.doc` 파일 경로 지정
    
2. `.docx` 파일이 존재하지 않으면 LibreOffice로 변환 수행
    
3. LangChain 로더로 `.docx` 문서를 불러와 내용 추출
    
4. 첫 번째 문서 내용을 출력


## 전제 조건

- 시스템에 `libreoffice` CLI 설치되어 있어야 한다
```sh
sudo apt install libreoffice -y
```

- Python 환경에서 LangChain Community 패키지가 설치되어 있어야 한다  
    (예: `pip install langchain-community`)


## 코드 설명

### 1. 변환 대상 경로 설정

`pathlib.Path`를 사용해 `.doc` 경로와 그에 대응하는 `.docx` 경로를 만든다.

```python
from pathlib import Path

doc_path = Path("data/3. 휴가규정_(주)플래티어_250312.doc")
docx_path = doc_path.with_suffix(".docx")
```


### 2. `.doc` → `.docx` 변환 (LibreOffice 사용)

LibreOffice를 백그라운드 모드(`--headless`)로 실행해 `.docx`로 변환한다. 이미 `.docx`가 존재하면 이 과정을 생략한다.

```python
import subprocess

if not docx_path.exists():
    print(f"[INFO] .docx 파일이 없으므로 변환 중: {doc_path.name}")
    result = subprocess.run([
        "libreoffice", "--headless", "--convert-to", "docx", str(doc_path),
        "--outdir", str(doc_path.parent)
    ], capture_output=True)

    if result.returncode != 0:
        print("[ERROR] 변환 실패:\n", result.stderr.decode())
        exit(1)
    else:
        print(f"[SUCCESS] 변환 완료: {docx_path.name}")
```


### 3. LangChain을 통한 문서 파싱

변환된 `.docx` 파일을 `Docx2txtLoader`로 로딩한다. 문서는 하나 이상의 `Document` 객체로 반환된다.

```python
from langchain_community.document_loaders import Docx2txtLoader

loader = Docx2txtLoader(str(docx_path))
docs = loader.load()
```


### 4. 문서 내용 출력

파싱된 문서 중 첫 번째 문서 내용을 확인할 수 있다.

```python
print("\n문서 미리보기:\n")
print(docs[0].page_content)
```


## 전체 코드

```python
from pathlib import Path
import subprocess
from langchain_community.document_loaders import Docx2txtLoader

# 1. .doc 경로 지정
doc_path = Path("data/3. 휴가규정_(주)플래티어_250312.doc")
docx_path = doc_path.with_suffix(".docx")

# 2. .doc → .docx 변환
if not docx_path.exists():
    print(f"[INFO] .docx 파일이 없으므로 변환 중: {doc_path.name}")
    result = subprocess.run([
        "libreoffice", "--headless", "--convert-to", "docx", str(doc_path),
        "--outdir", str(doc_path.parent)
    ], capture_output=True)

    if result.returncode != 0:
        print("[ERROR] 변환 실패:\n", result.stderr.decode())
        exit(1)
    else:
        print(f"[SUCCESS] 변환 완료: {docx_path.name}")

# 3. LangChain 로더로 문서 불러오기
loader = Docx2txtLoader(str(docx_path))
docs = loader.load()

# 4. 결과 출력
print("\n문서 미리보기:\n")
print(docs[0].page_content)
```


## 결론

이와 같은 파이프라인을 활용하면 `.doc` 형식으로 된 사내 문서를 자동으로 변환하고, 그 내용을 RAG 기반 검색 시스템, 텍스트 분석 파이프라인 등에서 활용할 수 있다. 특히 문서가 수십~수백 개 존재할 경우에도 반복적으로 처리할 수 있어 문서 자동화의 기초로 유용하다.