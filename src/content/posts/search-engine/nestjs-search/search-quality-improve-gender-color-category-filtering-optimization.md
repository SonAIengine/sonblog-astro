---
title: '검색 품질 개선: 성별/색상/카테고리 필터링 최적화'
description: x2bee-nest-search에서 임베딩 벡터 기반 성별/색상/계절/카테고리를 자동 감지해 검색 결과를 필터링하고 부스트하는
  구현 전략과 시행착오를 정리한다.
pubDatetime: 2026-02-17
tags:
- 검색품질
- 벡터검색
- 성별필터
- 카테고리분류
- OpenSearch
- NestJS
- 코사인유사도
- Search Engine
---


# 검색 품질 개선: 성별/색상/카테고리 필터링 최적화

"빨간 여성 코트"를 검색했을 때 남성용 검정 코트가 상위에 오면 검색 품질이 나쁜 것이다. 사용자가 명시적으로 "여성", "빨간"이라는 조건을 입력했으면 그것이 반영돼야 한다.

x2bee-nest-search에서는 사용자가 성별이나 색상을 직접 필터로 선택하지 않아도, **검색어 임베딩과 미리 계산된 성별/색상/계절 벡터의 코사인 유사도**를 통해 자동으로 감지하고 쿼리에 반영한다. 2024년 9월부터 11월 사이에 집중적으로 개발된 이 기능의 구현 방식과 튜닝 과정을 정리한다.

## 설계 방향: 명시적 필터 vs 의미적 감지

사용자가 "필터 > 여성"을 직접 클릭하는 것은 명시적 필터다. 이건 구현이 단순하다.

의미적 감지는 다르다. "여자 친구 생일 선물"에서 "여자"를 감지해 여성 상품을 우선 노출하거나, "시원한 여름 원피스"에서 "여름"을 감지해 계절 상품을 강조하는 것이다. 검색어에 명시적으로 필터 조건이 들어있지만 사용자가 별도 필터를 선택하지 않은 경우다.

이 두 방식을 구분하는 이유는 신뢰도 때문이다. "여자 친구"에서 "여자"를 너무 강하게 성별 필터로 걸면 남자친구에게 줄 남성 상품을 검색해도 여성 상품이 올라오는 부작용이 생긴다. 유사도 **임계값**으로 이 신뢰도를 조절한다.

## 벡터 데이터 사전 준비

성별, 계절, 색상에 대한 벡터를 코드 안에 하드코딩했다. 각각 LaBSE 모델로 임베딩한 384차원 벡터다.

```typescript
public sex() {
  return {
    여성: {
      sex_name: '여성',
      sex_vector: [
        0.08743628859519958, -0.4636676013469696, 0.21672718226909637,
        // ... 384개 값
      ],
    },
    남성: {
      sex_name: '남성',
      sex_vector: [
        // ... 384개 값
      ],
    },
  };
}

public season() {
  return {
    봄: { color_name: '봄', color_vector: [ /* ... */ ] },
    여름: { color_name: '여름', color_vector: [ /* ... */ ] },
    가을: { color_name: '가을', color_vector: [ /* ... */ ] },
    겨울: { color_name: '겨울', color_vector: [ /* ... */ ] },
  };
}

public color() {
  return {
    빨간색: { color_name: '빨간색', color_vector: [ /* ... */ ] },
    노란색: { color_name: '노란색', color_vector: [ /* ... */ ] },
    파란색: { color_name: '파란색', color_vector: [ /* ... */ ] },
    // ... 총 30개 색상
    // 살구색, 자주색, 청록색, 카키색, 민트색, 아이보리색,
    // 금색, 골드, 은색, 실버, 구리색, 진홍색, 황토색,
    // 인디고색, 에메랄드색, 라벤더색, 마젠타색, 청색, 코발트색,
    // 사파이어색, 루비색, 옥색, 석류색, 머스타드색, 올리브색 등
  };
}
```

이 벡터들은 서비스 시작 시 메모리에 올라가 있다. 검색 요청마다 임베딩 API를 호출하는 게 아니라, 검색어 임베딩과 이 사전 벡터들 사이의 코사인 유사도만 계산한다.

## 검색어 임베딩 + 유사도 계산

```typescript
// 검색어를 벡터로 변환 (Python 임베딩 서비스 호출)
const seasonVector = search_word
  ? await this.searchWordVectorOnly(analyzeResult)
  : null;

if (seasonVector && search_word.length > 1) {
  const seasonData = this.queryUtilService.season();
  const sexData = this.queryUtilService.sex();
  const colorData = this.queryUtilService.color();

  // 각 카테고리별 가장 가까운 값 찾기
  const seasonMatch = this.findClosestMatch(seasonData, seasonVector, 'color_vector');
  const sexMatch = this.findClosestMatch(sexData, seasonVector, 'sex_vector');
  const colorMatch = this.findClosestMatchValue(colorData, seasonVector, 'color_vector');

  ({ closestMatch: seasonKeyword, highestSimilarity: season_similarity } = seasonMatch);
  ({ closestMatch: sexKeyword, highestSimilarity: sex_similarity } = sexMatch);
  ({ closestMatch: colorKeyword, highestSimilarity: color_similarity } = colorMatch);
}
```

`findClosestMatch`는 주어진 카테고리 데이터 전체를 순회하면서 가장 높은 유사도를 가진 항목을 반환한다.

```typescript
public findClosestMatch(data, vector, vectorKey) {
  let closestMatch = '';
  let highestSimilarity = -1;

  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const similarity = this.queryUtilService.cosineSimilarity(
        vector,
        data[key][vectorKey],
      );
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        closestMatch = key;
      }
    }
  }

  return { closestMatch, highestSimilarity };
}
```

"빨간 코트"를 검색하면:
- `sexMatch`: 여성 0.41, 남성 0.32 → 여성(0.41)
- `seasonMatch`: 봄 0.28, 여름 0.22, 가을 0.38, 겨울 0.52 → 겨울(0.52)
- `colorMatch`: 빨간색 0.79, 노란색 0.31, ... → 빨간색 벡터(0.79)

이 숫자들이 임계값을 넘는지 여부에 따라 필터가 활성화된다.

## 임계값 설계

유사도 임계값은 단순하게 고정값으로 설정하지 않았다. 검색어의 토큰 수에 따라 달라진다.

```typescript
const wordCount = rawTokens
  .split(' ')
  .filter(word => word.trim() !== '').length;

const thresholds = {
  1: { similarityThreshold: 0.4, similaritySexThreshold: 0.4 },
  2: { similarityThreshold: 0.37, similaritySexThreshold: 0.35 },
  3: { similarityThreshold: 0.35, similaritySexThreshold: 0.3 },
  4: { similarityThreshold: 0.33, similaritySexThreshold: 0.25 },
  default: { similarityThreshold: 0.3, similaritySexThreshold: 0.2 },
};

const { similarityThreshold, similaritySexThreshold } =
  thresholds[wordCount] || thresholds.default;
```

단어가 1개인 검색어("코트")는 임계값이 높다(0.4). "코트" 하나만으로는 성별이나 계절을 명확히 판단하기 어렵기 때문에, 유사도가 매우 높은 경우에만 필터를 적용한다.

단어가 많을수록(4개 이상) 임계값이 낮아진다(0.2). "겨울 여성 빨간 롱코트"처럼 단어가 많으면 검색어 자체에 이미 다양한 의미가 담겨있고, 임베딩 벡터도 더 명확한 방향을 가리키기 때문에 낮은 유사도에서도 신뢰할 수 있다.

임계값은 검색 로그를 분석하면서 실험적으로 결정했다. 처음에는 모든 경우에 0.3을 사용했다가, 단어 수에 무관하게 오탐이 발생하는 것을 확인하고 동적으로 바꿨다.

## 각 필터의 쿼리 반영

### 성별 필터

성별은 두 가지 임계값으로 나뉜다.

```typescript
sex: sex_similarity > similaritySexThreshold ? sexKeyword : null,
sex_goodsNm: sex_similarity > 0.3 ? sexKeyword : null,
```

`sex`는 더 엄격한 임계값(단어 수에 따라 0.2~0.4)이고, `sex_goodsNm`는 고정 0.3이다. 두 필드에 서로 다른 강도로 성별 필터를 적용하는 전략이다.

쿼리 템플릿에서 성별은 `dis_max`로 구현한다.

```json
{
  "dis_max": {
    "queries": [
      {
        "query_string": {
          "query": "*여성*",
          "fields": ["goodsDtlDesc"],
          "boost": 3000
        }
      },
      {
        "query_string": {
          "query": "*여성*",
          "fields": ["goodsNmAnaly"],
          "boost": 3000
        }
      }
    ]
  }
}
```

`dis_max`를 쓴 이유는, 상품 설명(`goodsDtlDesc`)과 상품명 형태소 분리 버전(`goodsNmAnaly`) 중 더 높은 점수를 취하기 위해서다. "여성용 코트"처럼 상품명에 성별이 명시된 경우와 "상품 설명에 여성에게 추천합니다" 같은 경우를 모두 포착한다.

부스트 값은 GPT 적용 여부에 따라 달라진다.

```typescript
boost_sex: isVerb || !important_word ? 1000 : 3000,
```

GPT 결과(`important_word`)가 있을 때는 3,000, 없을 때는 1,000이다. GPT 결과가 없으면 검색어의 의도가 불분명할 수 있어 성별 필터의 신뢰도를 낮춘다.

### 색상 필터: Nested kNN

색상은 상품 자체가 아닌 색상 옵션 단위로 저장되어 있어 Nested kNN을 사용한다.

```typescript
color_script_score: {
  params: color_similarity > similarityThreshold ? colorKeyword : null,
},
boost_color: color_similarity > 0.5 ? 50000 : 1,
```

`colorKeyword`는 `findClosestMatchValue`가 반환하는 실제 색상 벡터다(색상 이름이 아닌 벡터 값 자체). 이것을 Nested kNN 쿼리의 `vector` 파라미터로 넣는다.

`boost_color`는 이진적으로 동작한다. 유사도가 0.5 이상이면 50,000, 그 이하면 1(사실상 비활성). 색상은 명확히 감지된 경우에만 강하게 반영하는 전략이다.

```handlebars
{{#if color_script_score.params}}
{
  "bool": {
    "should": [
      {
        "nested": {
          "path": "colorText",
          "query": {
            "knn": {
              "colorText.color_vector": {
                "vector": {{{json color_script_score.params}}},
                "k": 1000,
                "boost": 20000
              }
            }
          },
          "inner_hits": {
            "size": 1,
            "_source": {
              "includes": ["colorText.color_name", "colorText.sub_image_url"]
            }
          }
        }
      },
      {
        "bool": {
          "must_not": { "exists": { "field": "colorText" } }
        }
      }
    ]
  }
}
{{/if}}
```

색상 데이터가 없는 상품도 배제되지 않도록 `must_not exists` 블록을 함께 넣었다. "빨간 코트"를 검색했을 때 색상 정보가 없는 코트도 결과에 포함되어야 하기 때문이다. 유사도 높은 색상 kNN 점수를 받은 상품이 상위에 오고, 색상 정보 없는 상품은 kNN 점수 없이 키워드 점수만으로 랭킹된다.

### 계절 필터

```typescript
season: season_similarity > 0.4 ? seasonKeyword : null,
season_goodsNm: season_similarity > 0.4 ? seasonKeyword : null,
boost_season: isVerb || !important_word ? 1000 : 10000,
```

계절 임계값은 0.4로 고정이다. 계절은 상대적으로 명확히 감지되는 편이라 단어 수에 따른 동적 임계값을 쓰지 않았다.

부스트는 최대 10,000으로 성별(3,000)보다 높다. 계절성이 감지된 경우 해당 계절 상품을 매우 강하게 우선 노출한다.

```handlebars
{{#if season}}
{
  "query_string": {
    "query": "*{{season}}*",
    "fields": ["goodsDtlDesc"],
    "boost": {{boost_season}}
  }
}
{{/if}}
```

와일드카드(`*겨울*`)를 사용해 "겨울 아우터", "겨울용 패딩" 등 다양한 표현을 모두 매칭한다.

### 카테고리 필터: 모델 예측

카테고리는 GPT와 별도로 동작하는 카테고리 분류 모델을 사용한다.

```typescript
// 동사가 없을 때만 카테고리 모델 호출
if (!isVerb) {
  const categories = await this.fetchModelCategories(analyzeResult);

  // 모델이 반환한 카테고리 ID를 부스트 점수로 변환
  smallCategories = categories.map(({ id, score }) => ({
    id,
    score: score * 10000,
  }));
}
```

카테고리 모델은 검색어를 받아 관련 카테고리 ID와 신뢰도 점수를 반환한다. "코트"를 입력하면 `[{ id: "아우터", score: 0.89 }, { id: "코트류", score: 0.72 }]` 같은 결과가 온다.

이것을 OpenSearch 쿼리의 Nested 카테고리 부스트로 적용한다.

```handlebars
{{#each categoryListNo}}
{
  "term": {
    "dispCtgNo.subCtgNm.keyword": {
      "value": "{{this.id}}",
      "boost": {{this.score}}
    }
  }
}{{#unless @last}},{{/unless}}
{{/each}}
```

신뢰도 0.89인 "아우터" 카테고리 상품은 8,900 점수 부스트를 받는다. 0.72인 "코트류"는 7,200을 받는다. 카테고리가 더 정확하게 맞는 상품이 상위에 오게 된다.

## 성별 가중치 최적화의 긴 여정

성별 필터 튜닝에 가장 많은 시간이 걸렸다. 커밋 이력이 이를 잘 보여준다.

```
# 커밋: fix: 성별 점수 강화
# 날짜: 2024-11-25 01:38

# 커밋: fix: 성별 가중치 중복제거
# 날짜: 2024-10-22 08:09

# 커밋: fix: 성별 가중치 + 카테고리 가중치 조정
# 날짜: 2024-10-02 09:06

# 커밋: fix: 성별은 상품설명에서만
# 날짜: 2024-10-17 10:46

# 커밋: fix: 성별
# 날짜: 2025-01-07 14:05
# 날짜: 2025-01-07 14:37
# 날짜: 2025-01-08 10:30
```

초기 문제는 성별 필터가 너무 강하게 작동해서 의도치 않은 결과가 나오는 것이었다. "여자 친구 선물"을 검색하면 여성 상품이 올라와야 하지만, "여자친구 핸드백"처럼 여자친구에게 선물할 핸드백을 검색하는 경우에도 여성 카테고리로 과도하게 필터링되는 문제가 있었다.

처음에는 성별을 상품명(`goodsNm`)에서도 찾으려 했다가 상품설명(`goodsDtlDesc`)에서만 찾도록 범위를 좁혔다.

```
# 커밋: fix: 성별은 상품설명에서만
# 날짜: 2024-10-17 10:46
```

상품명에는 성별이 직접 언급되지 않고 설명에만 "여성용", "남성 추천" 같은 표현이 오는 경우가 많았기 때문이다.

나중에는 형태소 분리된 버전(`goodsNmAnaly`)도 추가했다. 상품명에 "여/남성" 같은 축약형이 있는 경우 Nori가 "여" + "성" 으로 분리해서 원문 매칭이 안 되는 경우가 있었기 때문이다.

## 색상 파이프라인의 시행착오

색상 필터는 초기에는 단순 키워드 매칭으로 구현했다. "빨간"이 들어있으면 빨간 색상으로 간주하는 방식이다.

```
# 커밋: feat: color opensearch로 이동
# 날짜: 2024-12-24 16:20
# 커밋: feat: color 적용
# 날짜: 2024-12-24 15:56
```

단순 키워드 매칭의 문제는 "빨간", "빨강", "레드", "RED"가 모두 같은 색상인데 동의어로 처리하지 않으면 누락이 발생한다는 점이다. 벡터 방식으로 전환한 이유가 여기에 있다. "빨간색" 벡터를 미리 계산해두면, 검색어에 "빨강", "레드", "빨간"이 있어도 모두 비슷한 유사도로 매칭된다.

색상 kNN을 Nested 구조로 구현한 것도 중요한 설계 결정이었다. 색상 옵션별로 서로 다른 이미지 URL이 있고, 검색 결과에 매칭된 색상의 이미지를 보여줘야 했기 때문이다.

```
# 커밋: fix: 색상 활성화 요소 추가
# 날짜: 2024-12-20 15:05
# 커밋: fix: 색상 must 영역으로 이동
# 날짜: 2024-12-20 15:41
```

색상 kNN을 `must` 절에 넣으면 색상 정보가 없는 상품이 아예 제외된다. 색상 정보가 있는 상품과 없는 상품을 모두 포함하되, 색상 일치하는 경우를 우선 노출하려면 `should` 절에 넣어야 한다.

## 결과: 의미적 필터의 효과

세 가지 필터를 도입한 후 검색 품질 지표가 개선됐다.

가장 명확한 개선은 색상 검색이었다. 기존에 "네이비 블루 코트"를 검색하면 "네이비"나 "블루"가 상품명에 포함된 상품만 나왔는데, 색상 벡터 kNN으로 실제로 진한 파란색 계열의 상품이 올라오기 시작했다.

계절 필터는 특히 패션 카테고리에서 효과가 컸다. "여름 원피스"를 검색할 때 반팔, 얇은 소재 등 여름 느낌의 원피스가 상위에 오고, 두꺼운 울 소재 원피스는 아래로 내려갔다.

성별 필터는 "남자 쇼핑몰" 같은 간접적 표현에서도 작동해서 남성 상품이 우선 노출됐다. 다만 "남자친구"에서 "남자"를 성별로 잘못 인식하는 케이스가 계속 남아있어, 임계값 조정을 반복했다.

이 기능의 핵심은 사용자가 별도 필터를 클릭하지 않아도 검색어의 의미를 파악해 자동으로 필터를 적용한다는 점이다. 단, 임계값 튜닝은 정답이 없다. 검색 로그를 지속적으로 분석하면서 거짓 양성(false positive)과 거짓 음성(false negative) 사이의 균형을 조정하는 작업이 필요하다.
