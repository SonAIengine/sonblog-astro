---
title: LangChain SemanticChunker — 의미 기반 텍스트 분할 가이드
description: LangChain의 SemanticChunker를 활용한 의미 기반 텍스트 분할을 정리한다. 문장 임베딩 유사도로 청크 경계를
  결정하는 방식, breakpoint_threshold 설정, RAG 검색 정확도 향상 효과를 다룬다.
pubDatetime: 2025-07-20
tags:
- RAG
- 검색엔진
- LangChain
- 청킹
- 시맨틱검색
- 임베딩
- Search Engine
---


## 의미 기반으로 분할하는 시맨틱 청킹

`SemanticChunker` 는 텍스트를 단순히 길이에 따라 나누는 것이 아닌, 의미적으로 유사한 내용을 가진 청크로 분할하는 도구이다. 텍스트를 문장 단위로 분할한 후, 서로 유사한 의미를 가진 문장들을 그룹화하여 하나의 청크로 구성한다. 이를 통해 문맥이 잘 연결된 상태로 분할되어, 텍스트의 의미를 보존하면서도 적절한 크기의 청크를 생성할 수 있다.

의미 분할 방식은 청크가 문맥적으로 일관성을 갖도록 하여 이후의 자연어 처리나 정보 검색에서 더욱 정확한 결과를 얻을 수 있다. 특히, RAG와 같은 작업에서 문맥이 잘 연결된 청크들이 입력되면, 모델의 응답 정화도가 크게 향상될 수 있다.

```python
from langChain_experimental.text_splitter import SemanticChunker
```

SemanticChunker 의 기본 파라미터는 `breakpoint_threshold_type='percentile'` 과 `breakpoint_threshold_amount=95` 로 설정되어 있다. 이는 의미적 차이의 분포에서 95번째 백분위수를 초과하는 지점, 즉 상위 5%에 해당하는 큰 차이가 발생하는 지점을 분할 기준으로 선택한다. 이를 통해 의미적으로 큰 전환이 일어나는 곳에서 자연스럽게 텍스트를 나눌 수 있다.


