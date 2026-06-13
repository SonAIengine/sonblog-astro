---
title: RAG 서비스의 토큰 관리와 컨텍스트 윈도우 최적화
description: xgen-workflow Iterative RAG에서 vLLM 32K 컨텍스트 한계를 관리하는 TokenBudgetManager
  구현 - 한글/영문 토큰 추정, 배치 필터링 토큰 제한, 압축 단계 토큰 예산 관리
pubDatetime: 2025-12-24
tags:
- RAG
- 토큰 관리
- LLM
- 컨텍스트 윈도우
- XGEN
- AI
---


Iterative RAG를 처음 구현했을 때 예상치 못한 문제가 발생했다. 반복 검색으로 많은 청크를 수집할수록 LLM에 보내는 프롬프트가 커지고, 어느 순간 컨텍스트 윈도우를 초과해서 오류가 났다. vLLM 32K 모델을 쓰고 있었는데, 배치 필터링 프롬프트가 30,000+ 토큰을 넘기면 요청 자체가 실패했다.

```
# 커밋: feat: Enhance token management and context limitations in RAGService and IterativeSearchEngine
# 날짜: 2025-12-24
```

이 문제를 해결하기 위해 `TokenBudgetManager`를 도입하고, 파이프라인 각 단계에 토큰 예산을 적용했다.

## 문제: 컨텍스트 오버플로우

Iterative RAG의 배치 필터링 단계는 LLM에 다음과 같은 프롬프트를 보낸다.

```
당신은 관련성 평가자입니다.

질문: [사용자 질문]

다음 문서 청크들이 질문과 관련이 있는지 평가하세요:

[청크 1]
[청크 2]
...
[청크 20]

각 청크에 대해 관련성을 평가하고 발견한 정보를 추출하세요.
```

청크 20개가 들어가는 배치에서, 청크 하나가 평균 800자라면 20개는 16,000자다. 한글 기준으로 대략 10,000+ 토큰이다. 프롬프트 자체와 출력 예약 공간까지 합치면 32K 모델의 한계에 근접한다.

초기 구현에서는 이 제한을 신경 쓰지 않았더니 배치 크기가 크거나 청크가 길 때 API 오류가 발생했다.

## TokenBudgetManager

```python
class TokenBudgetManager:
    """LLM 컨텍스트 윈도우 내에서 토큰 예산을 관리"""

    # vLLM 32K 컨텍스트에서 4K 안전 마진을 제외
    MAX_LLM_CONTEXT = 28000

    def __init__(self, max_tokens: int = 4000):
        self.max_tokens = max_tokens           # 출력 토큰 예산
        self.reserved_for_metadata = 500       # 메타데이터/시스템 프롬프트 예약
        self.content_budget = max_tokens - self.reserved_for_metadata

    def estimate_tokens(self, text: str) -> int:
        """
        tiktoken 없이 토큰 수 추정.
        한글: 1.5자당 1토큰 (한 글자가 1~2 토큰)
        영문: 4자당 1토큰 (평균 서브워드)
        """
        korean_chars = len(re.findall(r'[가-힣]', text))
        other_chars = len(text) - korean_chars
        return int(korean_chars / 1.5 + other_chars / 4.0)

    def truncate_to_budget(
        self,
        text: str,
        budget_tokens: int | None = None,
    ) -> str:
        """토큰 예산 초과 시 비율로 잘라내기"""
        budget = budget_tokens or self.content_budget
        current_tokens = self.estimate_tokens(text)

        if current_tokens <= budget:
            return text

        ratio = budget / current_tokens
        target_chars = int(len(text) * ratio * 0.95)  # 5% 안전 마진
        return text[:target_chars] + "... (truncated)"
```

tiktoken 같은 정확한 토크나이저를 쓰지 않은 이유는 종속성을 줄이기 위해서다. 한글 1.5자당 1토큰은 실제 tokenizer 출력과 비교해서 나온 경험적 값이다. 정확하진 않지만 ±15% 오차 범위에서 동작하기에 충분했다.

## 배치 필터링 토큰 제한

배치 필터링 단계에서 토큰 예산을 적용했다.

```python
# 상수 정의
BASE_PROMPT_TOKENS = 800      # 시스템 프롬프트 + 질문 + 지시사항
MAX_CHARS_PER_CHUNK = 1500    # 청크당 최대 글자 수

async def _filter_batch_with_context(
    self,
    query: str,
    batch: List[SearchChunk],
    search_context: Dict,
    iteration: int,
) -> FilterResult:
    """토큰 예산 적용 배치 필터링"""

    MAX_CHUNK_TOKENS = self.token_manager.MAX_LLM_CONTEXT - BASE_PROMPT_TOKENS

    chunk_entries = []
    total_tokens = 0

    for idx, chunk in enumerate(batch):
        # 청크 길이 제한
        chunk_text = chunk.chunk_text
        if len(chunk_text) > MAX_CHARS_PER_CHUNK:
            chunk_text = chunk_text[:MAX_CHARS_PER_CHUNK] + "...(truncated)"

        chunk_entry = f"[청크 {idx + 1}]\n출처: {chunk.file_name} (p.{chunk.page_number})\n{chunk_text}\n"

        # 토큰 예산 체크
        entry_tokens = self.token_manager.estimate_tokens(chunk_entry)
        if total_tokens + entry_tokens > MAX_CHUNK_TOKENS:
            # 예산 초과 시 여기서 중단 (나머지 청크는 다음 배치로)
            break

        chunk_entries.append(chunk_entry)
        total_tokens += entry_tokens

    # 실제 처리된 청크만으로 프롬프트 구성
    chunks_text = "\n---\n".join(chunk_entries)
    ...
```

예산 초과 시 배치를 중단하는 방식이다. 20개 배치를 설정했더라도 토큰이 부족하면 실제로는 15개만 처리하고 나머지는 다음 반복으로 넘긴다.

## 컨텍스트 윈도우 최대화 전략

단순히 자르는 것 외에도 여러 최적화를 적용했다.

**청크당 최대 길이 제한**

```python
MAX_CHARS_PER_CHUNK = 1500  # 약 750 토큰 (한글 기준)
```

RAG 청크는 보통 512토큰 전후지만, 긴 PDF나 표 데이터는 훨씬 클 수 있다. 배치 필터링에서는 전체 내용이 필요하지 않으므로 앞 1500자만 사용한다.

**프롬프트 간소화**

```python
# v1 시스템 프롬프트 (길고 복잡)
system_prompt = """당신은 정보 검색 전문가입니다. 주어진 문서 청크들을 분석하여
질문과의 관련성을 정밀하게 평가해야 합니다. 각 청크에서 핵심 정보를 추출하고,
다음 검색 방향을 제시해 주세요. 특히..."""  # 수백 토큰

# v2 시스템 프롬프트 (간결)
system_prompt = "문서 청크를 평가하여 관련 정보를 JSON으로 반환하세요."
```

시스템 프롬프트를 줄이는 것만으로도 수백 토큰을 절약한다.

**압축 단계 토큰 관리**

Phase 4 압축 단계는 더 엄격한 제한을 적용한다.

```python
async def _compress_results(
    self,
    query: str,
    relevant_chunks: List[SearchChunk],
    extracted_facts: List[str],
) -> str:
    MAX_COMPRESSION_TOKENS = 20000  # 압축 프롬프트용 예산
    MAX_CHUNKS = 15      # 최대 청크 수
    MAX_FACTS = 10       # 최대 사실 수
    MAX_CHARS_PER_CHUNK = 500  # 압축 단계에서는 더 짧게

    chunk_summaries = []
    current_tokens = 0

    for chunk in relevant_chunks[:MAX_CHUNKS]:
        key_info = chunk.chunk_text[:MAX_CHARS_PER_CHUNK]
        entry = {
            "source": f"{chunk.file_name} (p.{chunk.page_number})",
            "content": key_info,
        }

        entry_str = json.dumps(entry, ensure_ascii=False)
        entry_tokens = self.token_manager.estimate_tokens(entry_str)

        if current_tokens + entry_tokens > MAX_COMPRESSION_TOKENS:
            break

        chunk_summaries.append(entry)
        current_tokens += entry_tokens
```

배치 필터링(관련성 평가)과 압축(최종 답변 생성)은 용도가 다르기 때문에 예산도 다르게 설정했다. 필터링은 청크 수가 많아도 각 청크를 짧게, 압축은 선별된 청크를 조금 더 길게 사용한다.

## SearchConfig 설정값 선택 이유

```python
@dataclass
class SearchConfig:
    search_top_k: int = 100     # 대량 후보 수집
    batch_size: int = 20        # 배치 크기
    max_iterations: int = 5     # 최대 반복
    max_output_tokens: int = 4000   # 최종 답변 길이 제한
    min_facts_to_stop: int = 5      # 조기 종료 사실 수
```

`batch_size=20`: 한 번의 LLM 호출로 20개 청크를 평가한다. 너무 많으면 토큰 초과, 너무 적으면 반복 횟수가 늘어난다. 청크당 평균 750토큰이면 20개는 15,000토큰, 시스템 프롬프트와 출력 예약을 합쳐 28,000 이하를 유지할 수 있는 값이다.

`max_output_tokens=4000`: 최종 답변 생성에 할당하는 토큰. 상세한 분석이 필요한 질문은 2,000~3,000토큰이 적당하고, 4,000은 충분한 여유다.

`min_facts_to_stop=5`: 5개 이상의 사실을 수집하면 조기 종료한다. 경험적으로 일반적인 업무 질문은 3~5개 핵심 사실로 충분한 답변이 가능했다.

## JSON 파싱 실패 폴백

LLM이 항상 정확한 JSON을 반환하지는 않는다. 파싱 실패 시 폴백을 구현했다.

```python
try:
    filter_result = FilterResult(**json.loads(llm_response))
except (json.JSONDecodeError, KeyError, TypeError):
    # 파싱 실패: 빈 결과로 처리 (해당 배치는 관련 없는 것으로 간주)
    filter_result = FilterResult(
        relevant_chunk_indices=[],
        extracted_facts=[],
        found_topics=[],
        promising_files=[],
        promising_pages=[],
        is_sufficient=False,
        relevance_score=0.0,
        suggested_query=None,
    )
    logger.warning(f"LLM JSON 파싱 실패: {llm_response[:100]}...")
```

파싱 실패 시 빈 결과로 처리하고 다음 배치로 넘어간다. 이 배치의 청크들이 실제로는 관련 있더라도 어쩔 수 없다. 안정성이 우선이다.

압축 단계 폴백은 다르다.

```python
try:
    compressed = json.loads(llm_response)
    return compressed.get("answer", "")
except json.JSONDecodeError:
    # 압축 실패: 수집된 사실들을 직접 연결해서 반환
    fallback = "\n".join([f"- {fact}" for fact in extracted_facts])
    return f"검색 결과 요약:\n{fallback}"
```

최종 답변 생성 단계에서 실패하면 수집된 사실들을 목록으로 그대로 반환한다. 보기 좋지는 않지만 정보 자체는 전달된다.

## 실전에서 배운 것

**tiktoken을 쓰지 않은 게 맞는 선택이었나?**

사후에 보면 약간 아쉽다. 추정 오차 15%가 배치 크기가 클 때는 문제가 없었지만, 영어로만 된 코드 문서를 처리할 때 오차가 더 커졌다. 영문은 4자당 1토큰이지만 코드는 서브워드 분리가 다르게 일어난다. 컨텍스트 오버플로우가 반복된다면 tiktoken 도입을 고려할 것이다.

**MAX_LLM_CONTEXT = 28000**

32,000 - 4,000 마진이다. 4,000 마진은 경험적으로 정했다. 처음에는 2,000이었는데 실제 프롬프트 오버헤드가 예상보다 커서 2번 정도 더 늘렸다. 안전 마진이 충분히 크지 않으면 특정 질문에서 간헐적으로 실패한다.

**배치 크기 vs 반복 횟수 트레이드오프**

배치를 크게 하면 반복이 줄고 LLM 호출 횟수가 줄지만, 토큰 예산이 빨리 찬다. 배치를 작게 하면 더 꼼꼼한 평가가 가능하지만 반복이 늘어난다. `batch_size=20`은 실제 문서들로 테스트해서 찾은 균형점이었다.
