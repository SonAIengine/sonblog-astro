---
title: GPT 모델 처음부터 만들기 (2) - 셀프 어텐션 구현
description: GPT 구현 시리즈 2편. 셀프 어텐션 메커니즘의 원리를 이해하고 PyTorch로 직접 구현한다. Query/Key/Value
  행렬 생성, 어텐션 스코어 계산, 마스킹까지.
pubDatetime: 2025-07-09
tags:
- AI
- GPT
- 딥러닝
- Self-Attention
- Transformer
---


# GPT 모델 만들기 (2) - 셀프 어텐션 메커니즘

## 셀프 어텐션 추가하기
어텐션 메커니즘은 간단히 말해 문자나 단어 사이의 관계를 파악하고, 특정 정보의 중요성을 인식하는 메커니즘이다. 이 메커니즘을 이해하려면 두 가지 핵심 질문을 고민해야 한다.

1. **어떻게 단어 사이의 관계를 파악할 수 있을까?**
2. **어떻게 특정 정보의 중요성을 모델에 전달할 수 있을까?**

이러한 고민을 실제 코드로 구현해 보면 어텐션 메커니즘의 작동 원리를 더 깊이 이해할 수 있다. 코드를 통해 이론적 개념을 실제로 적용해 보면서 어텐션 메커니즘이 어떻게 작동하는지 더 명확하게 파악할 수 있다. 

먼저 문자들 간의 정보를 주고받는 방법을 생각해보겠다.

### 문자들 간에 정보를 주고받는 방식(평균 방식)
간단한 숫자 데이터를 가지고, 문자들 간에 정보를 주고받는 방법을 살펴보겠다.

배치(batch) 크기가 2이고, 시퀀스(sequence) 길이가 4, 그리고 임베딩(embedding) 차원이 6인 데이터를 생성한다. 데이터의 내용은 중요하지 않기 때문에 `torch.randn` 함수를 사용해 랜덤한 값으로 데이터를 만든다. 이렇게 생성된 4개의 시퀀스는 서로 연관성이 없는 랜덤한 숫자들로 구성된다.

```python
import torch
torch.manual_seed(1441)

num_batches, sequence_length, embedding_dim = 2, 4, 6
embeddings_tensor = torch.randn(num_batches,
								sequence_length,
								embedding_dim)

print(embeddings_tensor.shape)
```

> torch.Size([2, 4, 6])

이 코드의 목표는 더 나은 예측을 위해 시퀀스들이 서로 어떻게 정보를 주고받을 수 있는지를 알아보는 것이다. 여기서 주목할 점은 4개의 시퀀스가 순차적으로 입력된다는 것이다. 시퀀스들끼리 정보를 주고받는 방법은 코사인 유사도 등 다양하지만, 여기서는 가장 쉬운 방법인 평균을 구하는 방식으로 설명하겠다.

다음으로, embeddings_tensor를 활용해 averaged_embeddings라는 변수를 생성한다.
이 변수는 다음 시퀀스로 넘어갈 때마다 평균값을 사용하도록 설계된다.

```python
# 이전 임베딩의 평균을 저장할 텐서 초기화 
averaged_embeddings = torch.zeros((num_batches, sequence_length, embedding_dim))

# 각 배치에 대해 반복
for batch_index in range(num_batches):
	# 각 시퀀스 위치에 대해 반복
	for sequence_position in range(sequence_length):
		# 현재 시퀀스 위치까지의 이전 임베딩을 슬라이스
		previous_embeddings = embeddings_tensor[batch_index, :sequence_position + 1]
		# 현재 위치까지의 임베딩의 평균을 계산
		averaged_embeddings[batch_index, sequence_position] = torch.mean(
			previous_embeddings,
			dim=0
		)
```

이 과정에서 각 시퀀스의 정보를 압축해 다음 시퀀스로 전달할 수 있다. 임베딩의 중요성이 여기서 드러난다.
임베딩은 단어나 문자를 숫자 벡터로 표현하는 방법이다. 왕을 나타내는 임베딩과 여자를 나타내는 임베딩을 더하면 여왕의 임베딩이 나오는 것을 의미한다. 이러한 임베딩 벡터들의 평균을 사용하면 이전 정보의 특성을 효과적으로 요약할 수 있다. 시퀀스 내 각 시점에서 이전의 모든 문자의 정보를 모아 평균을 계산함으로써 정보를 집계하고 문맥을 반영한다. 

예를 들어, "나는 학교에 간다"라는 문장에서 '간다'를 해석할 때 이전 단어들의 임베딩 벡터의 평균은 '나', '는', '학교', '에'의 의미를 포함한 새로운 벡터가 된다. 이 평균 벡터는 문장의 전반적인 문맥을 나타내며, 모델이 '간다'와 같은 다음 단어를 더 정확하게 예측하거나 이해하는 데 도움을 준다.

이 방법은 간단하지만 시퀀스 내에서 이전 정보를 현재에 효과적으로 전달하는 방법으로 사용된다.

`averaged_embeddings[0]` 의 값은 시퀀스가 증가함에 따라 변화한다. 하지만 for 문을 사용하는 방식은 시간 복잡도 문제로 인해 효율적이지 않다. 대신 **행렬곱**을 활용해 이 과정을 더욱 간단하고 효율적으로 수행할 수 있다.

### 셀프 어텐션이란?
시퀀스가 증가하면서 의미 정보를 어떻게 전달할 수 있는지 알아봤고 마스크를 사용해 모델이 중요한 정보에 집중할 수 있게 하는 과정을 살펴봤다.

이제 본격적으로 셀프 어텐션에 대해 알아보겠다. 셀프 어텐션은 입력 시퀀스(문장)내 모든 단어 간의 관계를 직접 분석하고 처리한다.

이 과정에서 각 단어가 다른 모든 단어와 어떻게 상호작용하는지 계산하며, 단어들 간의 유사도를 측정해 연관성 높은 단어 쌍을 파악한다. 이를 통해 문장 내 단어들 사이의 복잡한 연관성을 포착하고 이해한다.

입력 시퀀스(문장)를 쿼리(Query, Q), 키(Key, K), 밸류(Value, V) 세 개로 복사한다.
Query는 질문하는 역할을 하는 문장으로 생각하면 된다.

- Key는 Query가 한 질문에 답변하는 역할을 하는 문장이다. Value는 실제 전달되는 정보를 나타낸다.
- Query의 질문이 행렬로 들어오므로 Key는 행렬 연산을 위해 전치(Transpose)되고 행렬 연산이 진행된다. 이 과정에서 Query와 Key의 관련성을 계산한다. 행렬 연산으로 tensor의 크기가 변경되는데, 이를 다시 복원하기 위해 Value와 연산을 진행한다.
- 또한, Value는 Query와 Key의 관련성에 따라 가중치가 부여되어 최종 출력을 생성하는 데 사용된다.

결과적으로 각 단어의 새로운 표현은 시퀀스 내 모든 단어와의 관계를 반영한다. 이러한 과정은 셀프 어텐션 메커니즘의 핵심 작동 원리이다. 이를 통해 입력 시퀀스 내의 각 요소가 다른 모든 요소와 어떻게 관련되는지 파악하고 문맥을 고려한 더 풍부한 표현을 생성한다.

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

# 고정된 난수 시드 설정
torch.manual_seed(1111)

# 배치 크기, 시퀀스 길이, 채널 수 설정
batch_size, seq_length, num_channels = 2, 4, 4
input_tensor = torch.randn(batch_size, seq_length, num_channels)

# 각 헤드의 크기
head_size = 16

# Key, Query, Value 변환을 위한 선형 레이어
key_transform = nn.Linear(num_channels, head_size, bias=False)
query_transform = nn.Linear(num_channels, head_size, bias=False)
value_transform = nn.Linear(num_channels, head_size, bias=False)

# Key, Query, Value 변환 수행
keys = key_transform(input_tensor)
queries = key_transform(input_tensor)
values = key_transform(input_tensor)

# Attention 스코어 계산
attention_scores = queries @ keys.transpose(-2, -1)

# 하삼각행렬 생성 및 마스킹
mask_lower_triangle = torch.tril(torch.ones(seq_length, seq_length))
attention_scores = attention_scores.masked_fill(mask_lower_triangle == 0, float('-inf'))

# 소프트맥스 함수를 사용해 확률 정규화
normalized_scores = F.softmax(attentino_scores, dim=-1)

# 최종 출력 계산
output_tensor = normalized_scores @ values

output_tensor
```

먼저 torch.manual_seed(1111) 을 설정해 결과의 재현성을 보장한다. batch_size 2, seq_length 4, 그리고 num_channels 4인 임의의 input_tensor를 생성한다.

셀프 어텐션 메커니즘을 구현하기 위해 세 개의 선형 변환 key_transform, query_transform, value_transform 을 정의한다. 각각에 대해 nn.Linear를 활용해 입력 차원을 head_size로 변환하는데, 여기서 head_size는 16으로 설정한다.

이 선현 변환을 input_tensor에 적용해 keys, queries, values 표현을 얻는다. queries와 keys 표현의 내적을 통해 `attention_scores` 를 계산한다. 이 scores는 미래의 시퀀스 정보를 차단하기 위해 하위 삼각 행렬 `mask_lower_triangle` 로 마스킹 처리 한다. 여기서 사용된 `torch.tril()` 은 상위 삼각 부분을 0으로 만든다. 그래서 이렇게 생성된 행렬은 각 위치에서 현재와 과거 정보만을 참조할 수 있도록 하는 마스크 역할이 되는 것이다.  

마스킹 처리한 scores는 `float('-inf')` 로 `-inf`  값이 입력으로 주어지면 지수함수 값은 0에 매우 가까운 극솟값이 된다. 이는 설정한 미래의 위치를 포함하며, 모델의 의사결정 과정에서 해당 요소의 영향력을 제거하기 위해 소프트맥스 적용 시 해당 위치의 가중치를 0으로 만든다. 

F.softmax 함수를 사용해 정규화된 attention_scores인 normalized_scores를 계산한다. 이렇게 정규화된 어텐션 가중치를 최종적으로 values에 적용해 셀프 어텐션의 결과인 output_tensor를 얻는다.

`output_tensor` 는 각 시퀀스 위치에 과거와 현재의 정보만을 고려해 얻은 새로운 표현으로 나타내며, 이 과정은 모델이 시퀀스 내의 각 위치에 관련 정보를 동적으로 집약하는데 도움을 준다.

이런 방식으로 셀프 어텐션 메커니즘은 시퀀스 데이터를 처리할 때 각 요소가 서로 어떻게 상호 작용하는지를 학습할 수 있게 하며, 특히 시퀀스 내에서 정보 흐름을 효과적으로 관리할 수 있게 한다.

앞서 설명한 셀프 어텐션 구현에서 한 가지 중요한 단계 생략했다. 이 단계는 '스케일링' 이라고 불리는 과정으로, 계산된 `attention_scores` 를 특정 값√dk 으로 나누는 것이다.  여기서 dk는 어텐션 메커니즘에서 사용되는 key 벡터의 차원 크기를 나타낸다.

이 과정을 처음에 설명하지 않은 이유는 셀프 어텐션의 기본 원리를 이해하는 데 집중하기 위해서이다. 하지만 이 스케이링 과정은 실제 구현에서 매우 중요하다.

이제부터 이 스케일링 과정이 왜 필요한지, 그리고 어떻게 적용해야 하는지에 대해 알아보겠다.

#### 왜 √dk로 나눠야 하는가?
dk가 필요한 이유는 바로 소프트맥수 함수 때문이다. 소프트맥스 함수는 언어 모델이 다음 에 올 단어를 선택하는 과정에서 중요한 역할을 한다. 이 함수는 모델이 각 단어 후보사이의 관련성을 계산하고 가장 적절한 다음 단어를 결정하는 데 사용된다.

구체적으로, 소프트맥스 함수는 모델이 고려 중인 모든 가능한 다음 단어들에 대해 확률을 계산한다. 이 확률은 각 단어가 현재 문맥에 얼마나 잘 맞는지를 나타낸다. 결과적으로 가장 높은 확률을 가진 단어가 다음 단어로 선택된다. 이러한 과정을 통해 모델은 문맥에 가장 적합하고 자연스러운 다음 단어를 예측하고 생성한다.

하지만 이 과정에서 어텐션 점수가 극단적으로 커지거나 작아질 수 있다. 이로 인해 소프트맥스 함수 적용 시 한 노드의 점수가 다른 노드들에 비해 지나치게 높아지거나 낮아질 수 있다. 결과적으로 한 노드가 다른 모든 노드보다 과도하게 중요하다고 판단되는 상황이 발생할 수 있다.

간단한 예시를 살펴보겠다.
```python
batch_size, sequence_length, embedding_dim = 2, 4, 4

k = torch.randn(batch_size, seqence_length, embedding_dim)
q = torch.randn(batch_size, seqence_length, embedding_dim)

wei = q @ k.transpose(-2, -1)

wei.var()
```

>  실행 결과: tensor(4.7005)

이렇게 큰 값이 소프트맥스 함수로 들어가면 특정 위치의 값만 1에 가까워지고 나머지들은 0에 가까워지는 현상이 발생한다. 마치 여러 선택지 중에서 하나의 선택지만 극단적으로 선택되는 것과 같다. 

다음 코드는 내적 연산 후에 임베딩 차원의 제곱근√dk 으로 나눴다. 
```python
batch_size, sequence_length, embedding_dim = 2, 4, 4

k = torch.randn(batch_size, seqence_length, embedding_dim)
q = torch.randn(batch_size, seqence_length, embedding_dim)

wei = q @ k.transpose(-2, -1) * (embedding_dim ** -0.5)

wei.var()
```

> 실행결과: tensor(0.6440)

그 결과 분산이 0.6440 으로 크게 감소했다. 이렇게 값을 적절한 범위로 조절해 주면, 소프트맥스 함수가 여러 위치의 정보를 골고루 반영할 수 있게 된다.

만약 나눠주지 않으면 학습 과정에서 문제가 발생한다. 여기서 dk는 모델의 쿼리 벡터의 차원 크기이다. 신경망은 오차 역전파라는 방식으로 학습을 하는데, 이때 각 층을 거치면서 변화량(그레이디언트)이 점점 작어져서 결국 제대로 된 학습이 이뤄지지 않게 된다. 이는 마치 긴 거리를 거치면서 전달되는 메시지가 점점 약해지다가 결국 아예 전달되지 않는 것과 비슷하다. ---------- why?

따라서 √dk 로 나눠주는 스케일링(Scaling) 과정은 트랜스포머 모델의 안정적인 학습을 위해 매우 중요한 단계이다. 이는 마치 여러 의견을 균현 있게 듣고 결정을 내리는 것과 같은 원리로, 더 효과적인 학습을 가능하게 한다.

전체 코드를 다시 작성해 보겠습니다.

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

# 고정된 난수 시드 설정
torch.manual_seed(1111)

# 배치 크기, 시퀀스 길이, 채널 수 설정
batch_size, seq_length, num_channels = 2, 4, 4
input_tensor = torch.randn(batch_size, seq_length, num_channels)

# 각 헤드의 크기
head_size = 16

# Key, Query, Value 변환을 위한 선형 레이어
key_transform = nn.Linear(num_channels, head_size, bias=False)
query_transform = nn.Linear(num_channels, head_size, bias=False)
value_transform = nn.Linear(num_channels, head_size, bias=False)

# Key, Query, Value 변환 수행
keys = key_transform(input_tensor)
queries = key_transform(input_tensor)
values = key_transform(input_tensor)

# Attention 스코어 계산
scaling_factor = channel_size ** -0.5
attention_scores = queries @ keys.transpose(-2, -1) * scaling_factor

# 하삼각행렬 생성 및 마스킹
mask_lower_triangle = torch.tril(torch.ones(seq_length, seq_length))
attention_scores = attention_scores.masked_fill(mask_lower_triangle == 0, float('-inf'))

# 소프트맥스 함수를 사용해 확률 정규화
normalized_scores = F.softmax(attentino_scores, dim=-1)

# 최종 출력 계산
output_tensor = normalized_scores @ values

output_tensor
```

먼저 필요한 라이브러리를 임포트하고 난수 시드를 설정한다. 배치 크기, 시퀀스 길이, 채널 수를 정의하고 입력 텐서를 생성한다. 각 헤드의 크기를 16으로 설정한다.

Key, Query, Value 변환을 위한 선형 레이어를 정의하고, 이를 사용해 입력 텐서를 변환한다.

어텐션 스코어를 계산하기 위해 Query와 Key의 행렬곱을 수행한다. 그 후 하삼각행렬을 생성해 마스킹을 적용한다. 이는 각 토큰들만 참조할 수 있게 한다.

소프트맥스 함수를 사용해 어텐션 스코어를 확률로 정규화한다. 마지막으로, 정규화된 스코어와 Value의 행렬곱을 통해 최종 출력 텐서를 계산할 수 있다. 이 과정을 통해 √dk 가 적용되며, 이로써 셀프 어텐션 메커니즘의 전체 흐름을 구현해 봤다.