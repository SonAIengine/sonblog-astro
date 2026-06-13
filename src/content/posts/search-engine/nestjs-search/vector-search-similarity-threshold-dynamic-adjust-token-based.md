---
title: 벡터 검색 유사도 임계값 동적 조정 (토큰 수 기반)
description: 이커머스 검색에서 성별/색상/계절 벡터 필터 적용 여부를 결정하는 유사도 임계값을 검색어 토큰 수에 따라 동적으로 조정한 배경과
  구현을 정리한다.
pubDatetime: 2026-02-17
tags:
- 벡터검색
- 코사인유사도
- 임계값
- 검색품질
- NestJS
- OpenSearch
- 성별필터
- Search Engine
---


# 벡터 검색 유사도 임계값 동적 조정 (토큰 수 기반)

벡터 검색에서 "이 검색어가 '빨간색'을 의미하는가?"를 판단하는 기준이 임계값(threshold)이다. 코사인 유사도가 0.47 이상이면 색상 필터를 활성화하고, 그 이하면 무시한다. 단순해 보이지만 실제로는 이 숫자 하나가 검색 품질을 크게 좌우한다.

2024년 12월, x2bee-nest-search에서 고정 임계값 방식에서 토큰 수 기반 동적 임계값 방식으로 전환했다. 왜 고정값이 문제였고, 어떻게 해결했는지를 실제 커밋 기준으로 정리한다.

## 배경: 고정 임계값의 문제

초기 구현은 간단했다. 코사인 유사도가 0.47 이상이면 색상 필터 적용, 0.3 이상이면 성별 필터 적용.

```typescript
// 초기 코드 (수정 전)
color_script_score: {
  params: color_similarity > 0.47 ? colorKeyword : null,
},
sex: sex_similarity > 0.3 ? sexKeyword : null,
```

이것이 문제없이 작동하는 경우도 있었다. "빨간 코트"를 검색하면 색상 유사도가 0.79 정도 나와서 임계값 0.47을 충분히 넘는다. 하지만 특정 케이스에서 오탐이 발생했다.

**케이스 1: 짧은 검색어의 과도한 필터 적용**

"코트"(단어 1개)를 검색하면 임베딩 벡터가 어디를 가리키는지 불명확하다. 유사도 계산을 해보면 특정 색상과 0.35 정도의 유사도가 나오는 경우가 있다. 0.35는 임계값 0.47보다 낮으니 색상 필터가 적용되지 않아야 하지만, 다른 검색어에서 0.35는 충분히 의미 있는 유사도일 수 있다.

더 큰 문제는 성별이었다. "코트" 하나만 검색했을 때 임베딩 벡터가 우연히 "여성" 벡터와 0.31 정도 유사도가 나오면, 0.3 임계값을 겨우 넘어 성별 필터가 걸린다. 사용자는 그냥 "코트"를 검색했는데 여성 코트만 올라오는 상황이 된다.

**케이스 2: 긴 검색어의 필터 누락**

"겨울에 입기 좋은 따뜻한 빨간 여성 롱 코트"(단어 7개)를 검색하면 임베딩 벡터가 복잡한 의미를 담는다. 색상 유사도가 0.62 정도 나오는데, 이건 명확하게 "빨간"이 포함된 검색이다. 하지만 단어가 많아서 벡터가 여러 개념으로 분산되어 유사도가 전체적으로 낮아지는 경향이 있다. 임계값이 0.47로 고정이면 0.42짜리 유사도는 무시된다. 사용자가 명시적으로 "빨간"을 말했는데 필터가 안 걸리는 것이다.

## 핵심 인사이트: 단어 수와 임베딩 특성의 관계

```
단어 1개: "코트"
→ 임베딩이 "코트"라는 개념 하나를 강하게 표현
→ 특정 색상/성별과 우연히 높은 유사도가 나올 위험
→ 높은 임계값 필요

단어 5개+: "겨울 여성 빨간 롱 코트"
→ 임베딩이 여러 개념의 평균을 표현
→ 개별 개념의 유사도가 분산되어 낮아짐
→ 낮은 임계값으로도 의미 있는 신호 포착 가능
```

이 인사이트를 코드로 표현하면 **검색어가 길수록 임계값을 낮춰야 한다**는 결론이 나온다.

## 구현: 토큰 수 기반 동적 임계값

```
# 커밋: fix: 벡터 검색 token 개수에 따른 유사도 컷 설정
# 날짜: 2024-12-24 09:32
```

```typescript
// 형태소 분리 후 실제 토큰 수 계산
const rawTokens = result.analyzeResult; // "반팔 티셔츠" 형태

const wordCount = rawTokens
  .split(' ')
  .filter(word => word.trim() !== '').length;

let similarityThreshold;    // 색상 임계값
let similaritySexThreshold; // 성별 임계값

if (wordCount === 1) {
  similarityThreshold = 0.5;    // 단어 1개: 높은 기준
  similaritySexThreshold = 0.5;
} else if (wordCount === 2) {
  similarityThreshold = 0.47;   // 단어 2개: 기본
  similaritySexThreshold = 0.4;
} else if (wordCount === 3) {
  similarityThreshold = 0.47;   // 단어 3개: 동일
  similaritySexThreshold = 0.3;
} else if (wordCount === 4) {
  similarityThreshold = 0.43;   // 단어 4개: 약간 낮춤
  similaritySexThreshold = 0.25;
} else {
  similarityThreshold = 0.31;   // 단어 5개+: 낮은 기준
  similaritySexThreshold = 0.2;
}
```

현재 코드는 이후 추가 튜닝을 거쳐 아래와 같이 정리됐다.

```typescript
const thresholds = {
  1: { similarityThreshold: 0.4, similaritySexThreshold: 0.4 },
  2: { similarityThreshold: 0.37, similaritySexThreshold: 0.35 },
  3: { similarityThreshold: 0.35, similaritySexThreshold: 0.3 },
  4: { similarityThreshold: 0.33, similaritySexThreshold: 0.25 },
  default: { similarityThreshold: 0.3, similaritySexThreshold: 0.2 },
};

const selectedThresholds = thresholds[wordCount] || thresholds.default;
similarityThreshold = selectedThresholds.similarityThreshold;
similaritySexThreshold = selectedThresholds.similaritySexThreshold;
```

초기 커밋에서는 1개 단어에 0.5, 5개 이상에 0.31을 사용했다. 실제 운영 로그를 보고 나서 1개 단어는 0.4로 낮추고, 전체적으로 조정했다. 처음 0.5는 너무 엄격해서 명확한 색상 검색어에서도 필터가 안 걸리는 경우가 있었다.

## 임계값 적용

동적으로 계산된 임계값은 색상과 성별 필터에 각각 적용된다.

```typescript
const templateData = {
  color_script_score: {
    // 색상 임계값: 단어 수에 따른 동적값
    params: color_similarity > similarityThreshold ? colorKeyword : null,
  },
  season: season_similarity > 0.4 ? seasonKeyword : null, // 계절: 고정 0.4
  sex: sex_similarity > similaritySexThreshold ? sexKeyword : null, // 성별: 동적값
  sex_goodsNm: sex_similarity > 0.3 ? sexKeyword : null,  // 성별(상품명): 고정 0.3
  boost_color: color_similarity > 0.5 ? 50000 : 1,        // 색상 부스트: 이진
};
```

계절(`season`)은 0.4로 고정이다. 계절 표현은 상대적으로 명확해서 단어 수에 따른 임계값 변동이 크지 않았다. 실험적으로 동적 임계값을 적용해봤지만 검색 품질 차이가 없어 고정값으로 유지했다.

`sex_goodsNm`는 0.3 고정이다. 이것은 성별 필터의 "약한 버전"으로, 더 관대한 기준으로 성별 관련 텍스트를 상품명에서 찾는다. 엄격한 `sex`와 관대한 `sex_goodsNm`를 함께 사용해 다양한 케이스를 커버한다.

색상 부스트(`boost_color`)는 임계값 방식이 아닌 이진 방식이다. 유사도 0.5 이상이면 50,000, 미만이면 1. 색상이 명확히 감지된 경우에만 강하게 부스트하는 전략이다.

## 토큰 수의 정확한 의미

`rawTokens`는 형태소 분석을 거친 결과다. 원문 검색어("겨울에 입기 좋은 코트")를 Nori로 분석하면 동사/조사 등이 제거되고 명사만 남는다.

```
원문: "겨울에 입기 좋은 따뜻한 코트"
Nori 분석:
  겨울/NNG
  입/VV (동사)
  기/ETN
  좋/VA (형용사)
  은/ETM
  따뜻/XR
  한/XSA
  코트/NNG

hasVerb = true (입/VV 감지)
→ 명사만 추출: "겨울 코트"
→ rawTokens = "겨울 코트"
→ wordCount = 2
```

원문이 5단어지만 형태소 분석 후 의미 있는 토큰은 2개다. `wordCount`는 형태소 분리 후 명사 기준으로 계산한다. 이것이 더 정확하다. "정말 예쁜 빨간 코트"에서 "정말", "예쁜"은 의미에 크게 기여하지 않는다. 형태소 분석 후 "빨간 코트"(2개)로 줄어드는 것이 임계값 결정에 더 적합하다.

## 시행착오: 임계값 튜닝의 어려움

임계값은 정답이 없다. "빨간 코트"에서 색상 유사도 0.79는 명확하지만, "붉은 느낌의 코트"에서는 0.41 정도가 나올 수 있다. 0.41이 "빨간"을 의미하는지 아닌지는 문맥에 따라 다르다.

초기에는 단어 1개 임계값을 0.5로 설정했다가 너무 엄격했다는 것을 발견했다. "빨간"이라는 단어 하나만 검색했을 때도 색상 필터가 안 걸리는 경우가 있었다. "빨간"이 1개 단어라도 이건 명확한 색상 검색이다.

```
원문: "빨간"
rawTokens: "빨간"
wordCount: 1
similarityThreshold: 0.5 (초기)

색상 유사도: 빨간색=0.81, 검정색=0.23, 파란색=0.19
→ 0.81 > 0.5이므로 색상 필터 적용 ← 정상 동작

색상 유사도: (일부 모호한 표현) = 0.43
→ 0.43 < 0.5이므로 필터 미적용 ← 과도하게 엄격
```

현재 0.4로 낮춘 것은 이런 케이스들을 반영한 결과다.

반대로 성별 임계값이 너무 낮으면 오탐이 생긴다.

```
원문: "여자 친구 선물 핸드백"
rawTokens: "여자 친구 선물 핸드백"
wordCount: 4
similaritySexThreshold: 0.25 (4단어)

성별 유사도: 여성=0.28, 남성=0.19
→ 0.28 > 0.25이므로 여성 필터 적용

문제: 남자친구에게 줄 핸드백이라면 여성 필터가 맞는가?
→ 맞을 수도 있고, 틀릴 수도 있음 (남성용 핸드백도 있음)
```

이 케이스는 해결이 어렵다. 현재 0.25 임계값은 실제 검색 로그에서 여성 관련 검색어가 많다는 통계를 반영한 값이다. 이커머스 특성상 여성 고객이 더 많고 선물 검색도 여성 제품이 많다는 도메인 지식이 반영됐다.

## 임계값과 부스트의 독립적 조정

중요한 설계 원칙은 임계값(활성화 여부)과 부스트(활성화 강도)를 독립적으로 조정한다는 점이다.

```typescript
// 임계값: 필터 ON/OFF 결정
sex: sex_similarity > similaritySexThreshold ? sexKeyword : null,

// 부스트: 필터가 켜졌을 때의 강도
boost_sex: isVerb || !important_word ? 1000 : 3000,
boost_season: isVerb || !important_word ? 1000 : 10000,
boost_color: color_similarity > 0.5 ? 50000 : 1,
```

임계값을 낮춰서 더 많은 케이스에서 필터를 활성화하되, 부스트가 낮으면 큰 영향 없이 약하게 반영된다. 반대로 임계값은 엄격하게 유지하되 일단 활성화되면 부스트를 강하게 줄 수도 있다.

색상의 경우 `boost_color`가 50,000으로 매우 높다. 색상 임계값(0.3~0.5)을 넘으면 강하게 반영한다. 성별은 3,000으로 상대적으로 낮다. 성별 오탐의 영향을 제한하기 위해서다.

## 현재 결과와 개선 방향

동적 임계값 도입 후 단어 1~2개의 단순 검색에서 불필요한 성별 필터가 적용되는 케이스가 줄었다. "코트" 하나만 검색했을 때 여성 필터가 자동으로 걸리는 문제가 해소됐다.

반면 "빨간 여성 롱코트처럼 스타일리시한 것"같은 긴 자연어 검색에서 색상/성별 필터가 적절히 활성화되는 케이스가 늘었다.

아직 개선이 필요한 부분은 임계값 자동 튜닝이다. 현재는 검색 로그를 수동으로 분석하고 수치를 직접 조정한다. A/B 테스트나 클릭률 기반으로 임계값을 자동으로 최적화하는 피드백 루프가 있으면 더 좋을 것이다.

또한 현재 임계값은 단어 수만 고려한다. 단어의 품사나 의미적 명확성도 함께 고려한다면 더 정교한 임계값 결정이 가능하다. "빨간"처럼 명사 형용사가 명확히 색상을 가리키는 경우와 "빨간 느낌의"처럼 수식어로 쓰인 경우를 구분해서 임계값을 다르게 적용하는 것이다.
