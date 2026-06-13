---
title: GPT 모델 처음부터 만들기 (1) - 데이터 전처리와 기본 구조
description: GPT 언어 모델을 처음부터 구현하는 시리즈 1편. 텍스트 데이터 전처리, 문자 단위 토크나이저 구현, 입력/타겟 시퀀스 생성,
  기본 신경망 구조 설계까지.
pubDatetime: 2025-07-05
tags:
- AI
- GPT
- 딥러닝
- PyTorch
- Transformer
---


# GPT 모델 만들기 (1) - 데이터 전처리와 기본 모델 구조

## 1. 텍스트 데이터 전처리

텍스트 데이터가 필요하다.

data 딕셔너리의 train 키에서 document 값을 가져와 모든 문서를 하나의 문자열로 합친다.
이렇게 만들어진 전체 텍스트에서 중복을 제거하고 정렬된 고유한 문자 목록을 생성한다.

이 과정을 통해 데이터셋에 존재하는 모든 고유한 한국어 문자를 파악할 수 있다.

그 다음, 이 고유 문자 목록의 길이를 계산해 전체 어휘 크기를 구하고, 총 글자 수를 출력해 데이터셋의 어휘 다양성을 확인한다.

다음으로, 문자와 인덱스를 매핑하는 딕셔너리를 생성한다. 이러한 매핑은 텍스트 데이터를 숫자로 변환하고 다시 텍스트로 복원하는 데 사용된다.

 >데이터를 텐서로 변환하고 데이터 타입을 long으로 지정하는 과정은 딥러닝 모델의 효율적인 학습과 처리를 위해서 중요하다. 텐서는 딥러닝에서 데이터를 표현하는 기본 단위로, 다차원 배열 형태로 데이터를 저장하고 처리한다. 문자열을 숫자로 인코딩하고 이를 텐서로 변환하는 과정은 모델이 텍스트 데이터를 이해하고 학습할 수 있도록 하는 필수적인 전처리 단계이다.
 >
 >데이터 타입을 long으로 지정하는 이유는 주로 텍스트 데이터의 특성과 관련이 있다. 텍스트 데이터를 숫자로 인코딩할 때 각 단어나 토큰에 해당하는 정수 값이 큰 범위를 가질 수 있기 때문이다. long 타입은 32비트 정수형보다 더 큰 범위의 정수를 표현할 수 있어 큰 어휘 사전을 다룰 때 유용하다. 또한, 파이토치의 많은 함수들이 기본적으로 long 타입의 인덱스를 기대하기 때문에 이를 사용하면 추후 처리 과정에서의 호환성을 보장할 수 있다.
 >
 >이러한 텐서 변환과 데이터 타입 지정은 모델이 데이터를 효율적으로 처리하고 GPU를 통한 빠른 연산을 가능하게 함으로써 모델의 성능과 학습 속도에 직접적인 영향을 준다.`

데이터의 타입을 모두 변경한 후, 다음 단계로 train 데이터셋과 test 데이터셋으로 나누는 작업을 수행한다.
이 과정은 머신러닝 모델의 학습과 평가를 위해 매우 중요하다.

데이터를 훈련용과 검증용으로 분리함으로써 모델의 성능을 객관적으로 평가하고 과적합을 방지할 수 있다.
훈련 데이터는 모델을 학습하는 데 사용되며, 검증 데이터는 학습된 모델의 성능을 테스트하는 데 활용된다.

이러한 분리 작업을 통해 모델이 새로운, 보지 못한 데이터에 대해 얼마나 잘 일반화되는지 확인할 수 있다.
데이터 분할 비율은 일반적으로 프로젝트의 특성과 데이터의 양에 따라 결정되지만, 보통 8:2 또는 9:1등의 비율로 훈련 데이터과 검증 데이터를 나누기도 한다.

데이터를 분할 때 데이터를 처음부터 마지막까지 순차적으로 훈련한다고 생각할 수 있지만, 실제 학습 과정은 그렇지 않다. 훈련 데이터는 block_size에 설정된 크기만큼의 청크(chunk) 단위로 무작위 샘플링해 학습을 진행한다. 데이터 블록(block) 단위로 나누는 것은 GPT와 같은 트랜스포머 기반 모델을 학습할 때 자주 사용하는 방법이다.

여기서 `block_size` 는 한 번에 모델이 처리할 수 있는 글자의 수를 정의한다. 예를 들어 `block_size`  를 8로 설정하면 모델은 데이터의 연속된 8개의 글자를 하나의 학습 단위로 이용한다. 

이러한 방식으로 데이터를 처리함으로써 모델은 **다양한 문맥에서 언어를 이해하고 생성하는 능력**을 키울 수 있다. 

또한 무작위 샘플링을 통해 모델이 데이터의 특정 부분에 과적합되는 것을 방지하고, 전체 데이터셋에 대해 고르게 학습할 수 있도록 한다.

`block_size` 를 8로 설정하고 데이터가 하나씩 언어 모델의 입력으로 어떻게 전달되는지 살펴보겠다.
흔히 `block_size` 를 컨텍스트 길이(context length)라고 부른다. 즉, 모델이 한 번에 처리할 수 있는 토큰의 최대 길이를 의미하며, 이는 모델의 성능과 효율성에 큰 영향을 미친다. 이 값을 적절히 설정하는 것은 모델의 학습과 추론 과정에서 매우 중요하다. 큰 `block_size` 는 모델이 더 긴 문맥을 이해할 수 있게 해주지만, 동시에 더 많은 계산 자원을 필요로 한다. 반면 작은 `block_size` 는 계산 효율성은 높일 수 있지만, 모델의 문맥 이해 능력을 제한할 수 있다. 따라서 주어진 사용 가능한 자원을 고려해 적절한 `block_size` 를 선택하는 것이 중요하다.

**train_dataset[:block_size]** 이런 식으로 훈련 데이터셋의 처음 8개 글자를 텐서 형태로 보여줄 수 있다. 이 텐서는 숫자 배열이며 각 숫자는 특정 글자를 나타낸다. **학습 과정에 이런 블록은 트랜스포머 모델이 각 글자 뒤에 나타날 글자를 예측하도록 돕니다.** 모델은 각 위치에서 글자를 예측하며, 이 과정을 통해 문장 구조와 언어 패턴을 학습한다. 예를 들어 모델에 1928이라고 인코딩된 텍스트 정보를 입력했다고 가정해보자, 모델은 1928이라는 숫자로 인코딩된 텍스트를 봤다면 다음 글자 2315를 예측할 때 1928을 사용하고, 그 다음 글자인 0을 예측할 때는 1928과 2315를 함께 사용해 예측하도록 훈련한다.


```python
x = train_dataset[:block_size]
y = train_dataset[1:block_size+1]

for time in range(block_size):
	context = x[:time+1]
	target = y[time]

	print(f"입력 텐서 : {context}")
	print(f"타깃 텐서 : {target}")
```

인공지능 모델 훈련 시에는 단일 글자 텐서만 입력으로 주어지지 않는다. 여러 개의 텐서가 함께 묶여 입력으로 제공된다. 이를 `배치(batch)` 라고 한다.


이제 `block_size` 와 `batch_size` 를 활용해 데이터가 어떻게 입력되는지 자세히 살펴보겠다.
배치 처리는 모델의 학습 효율을 높이는 중요한 기법으로, 여러 데이터 샘플을 동시에 처리함으로써 계산 속도를 향상시키고 모델의 일반화 능력을 개선한다.


`block_size` 는 각 텐서의 길이를 결정하고, `batch_size` 는 한 번에 처리할 텐서의 개수를 설정한다.
이 두 매개변수를 적절히 조절하면 모델의 학습 속도와 성능을 최적화할 수 있다.

### PyTorch 언어 모델 학습을 위한 배치 생성 예제

```python
torch.manual_seed(1234)

batch_size = 4  # 한 번에 처리할 시퀀스 개수
block_size = 8  # 각 시퀀스의 길이 (컨텍스트 길이)

def batch_function(mode):
	dataset = train_dataset if mode == "train" else test_dataset
	idx = torch.randint(len(dataset) - block_size, (batch_size,))
	x = torch.stack([dataset[index:index+block_size] for index in idx])
	y = torch.stack([dataset[index+1:index+block_size+1] for index in idx])
	return x, y

example_x, example_y = batch_function("train")

for size in range(batch_size):
	for t in range(block_size):
		context = example_x[size, :t+1]
		target = example_y[size, t]
		print(f"input : {context}, target : {target}")
```

이 코드는 PyTorch를 사용하여 언어 모델 학습을 위한 **미니 배치(batch)** 를 생성하고, 그 배치에서 각 타임스텝의 **입력(context)** 과 **타깃(target)** 을 출력하는 예제이다.

 `torch.manual_seed(1234)` 는 PyTorch의 난수 생성 시드를 고정하여 **재현 가능한 결과**를 만든다.

`batch_size = 4`, `block_size = 8`  
- **batch_size**: 학습에 사용할 문장 또는 시퀀스의 개수 (한 번에 처리할 데이터 수)
- **block_size**: 각 시퀀스(문장)의 길이. 즉, 시퀀스 하나는 8개의 토큰으로 구성됨

#### 1. batch_function(mode)

 `train_dataset` 또는 `test_dataset` 중 하나에서 학습 배치를 만드는 함수이다.

```python
dataset = train_dataset if mode == "train" else test_dataset
```

- `mode`에 따라 사용할 데이터셋을 선택한다.


```python
idx = torch.randint(len(dataset) - block_size, (batch_size))
```

- 데이터셋에서 block_size만큼의 연속된 구간을 추출할 **시작 인덱스**를 무작위로 `batch_size`개 만큼 선택한다.

```python
x = torch.stack([dataset[index:index+block_size] for index in idx])
y = torch.stack([dataset[index+1:index+block_size+1] for index in idx])
```

- `x`: `[index : index + block_size]` 범위 → 입력 시퀀스
- `y`: `[index+1 : index + block_size + 1]` 범위 → 타깃 시퀀스 (한 칸 오른쪽으로 shift된 값)


**예시**
- x: `[1, 2, 3, 4, 5, 6, 7, 8]`
- y: `[2, 3, 4, 5, 6, 7, 8, 9]`  
    → 언어 모델에서는 주어진 context로 다음 단어를 예측하므로 이렇게 한 칸씩 이동시킨다.

 `example_x, example_y = batch_function("train")`

- 학습용 미니 배치를 하나 생성한다.

#### 2. context와 target을 하나씩 출력

```python
for size in range(batch_size):
	for t in range(block_size):
		context = example_x[size, :t+1]
		target = example_y[size, t]
		print(f"input : {context}, target : {target}")
```

예시

- `example_x[size] = [10, 20, 30, 40, 50, 60, 70, 80]`
- `example_y[size] = [20, 30, 40, 50, 60, 70, 80, 90]`

출력은 다음과 같이 됨

```text
input : tensor([10]), target : 20
input : tensor([10, 20]), target : 30
input : tensor([10, 20, 30]), target : 40
...
input : tensor([10, 20, 30, 40, 50, 60, 70, 80]), target : 90
```

이 구조는 GPT 계열의 오토리그레시브 모델에서 학습 시 주어진 `context`로 다음 토큰을 예측하는 방식과 같습니다. 

요약하자면, 이 코드는 언어 모델 학습을 위해
- 입력 시퀀스와 타깃 시퀀스를 자동 생성하고
- 각 타임스텝에서 `context → target` 관계를 출력하는 데, 이 과정에서 각 배치와 블록에 대한 입력(컨텍스트)과 해당 타킷(목표 글자)이 출력하는 것을 의미한다.
- 이를 통해 주어진 컨텍스트를 바탕으로 다음 글자를 예측하는 방식으로 학습한다.
- 코드 실행 결과는 모델이 각 배치 시퀀스를 처리하며 텍스트 구조와 언어 패턴을 학습하는 과정을 보여준다.


지금까지 데이터가 모델에 어떤 방식으로 전달되는지 살펴봤다.

이제 간단한 언어 모델을 직접 만들고 실험하면서 인공지능이 어떻게 언어를 학습하는지 단계별로 살펴보자.
마치 레고를 조립하듯이 인공지능 기능을 순차적으로 추가하고 훈련하면서 각 모델의 성능이 어떻게 개선되는지 관찰할 예정이다.

이 과정을 통해 언어 모델의 기본 구조를 이해하고, 각 구성 요소가 모델의 성능에 어떤 영향을 미치는지 직접 확인할 수 있다. 먼저 가장 기본적인 형태의 언어 모델을 설정하고, 점진적으로 복잡한 기능을 추가하면서 그 변화를 관찰해보자. 이러한 단계별 접근 방식은 복잡한 인공지능 시스템의 작동 원리를 더 쉽게 이해할 수 있게 해준다.

각 단계에서 모델 성능을 평가하고 분석해, 언어 모델의 발전 과정과 각 요소의 중요성을 깊이 있게 파악할 수 있다.


## 언어 모델 만들기
semiGPT 클래스를 만드는 과정은 객체 지향 프로그래밍의 기본 원칙을 따른다. 
- 첫 번째는 `__init__` 메서드로, 클래스의 초기화를 담당
- 두 번째는 `forward` 메서드로, 모델 실제 연산을 수행한다. `__init__` 메서드에서는 모델의 구조와 초기 파라미터를 설정하고, `forward` 메서드에서는 입력 데이터를 받아 모델을 통과시켜 출력을 생성한다.

이러한 구조는 파이토치와 같은 딥러닝 프레임워크에서 일반적으로 사용되는 방식으로, 모델의 구조를 명확하게 정의하고 사용하기 쉽게 만든다. 이렇게 설계된 semiGPT 클래스는 다양한 언어 모델링 작업에 활용될 수 있으며, 필요에 따라 쉽게 확장하거나 수정이 가능하다.

```python
import torch
import torch.nn as nn
from torch.nn import functional as F

class semiGPT(nn.Module):
	def __init__(self, vocab_length):
		super().__init__()
		# 토큰 임베딩 테이블: vocab_length x vocab_length 크기의 행렬
		self.embedding_token_table = nn.Embedding(vocab_length, vocab_length)
	
	def forward(self, inputs, targets=None):
		# 입력 토큰을 임베딩 벡터로 변환
		logits = self.embedding_token_table(inputs)
		return logits

model = semiGPT(ko_vocab_size)
output = model(example_x, example_y)
print(output.shape)
```

> 결과: torch.Size([4,8,2701])

먼저, 큰 흐름을 살펴보고 코드를 살펴보겠다.
semiGPT는 `__init__` 함수에서 `vocab_length` 를 (매개)변수로 받아 토큰 임베딩(embedding) 테이블을 만든다. 여기서 `vocab_length`는 모델이 다룰 수 있는 단어의 총 개수이므로 2701개가 된다.

임베딩 테이블은 각 단어를 고유한 숫자 벡터로 변환하는 역할을 한다. 이를 코드로 구현한 부분이 
`self.token_embedding_table = nn.Embedding(vocab_length, vocab_length)` 이다.

이 코드를 더 자세히 살펴보면 `nn.Embedding`은 파이토치에서 제공하는 기능으로, 
단어를 벡터로 변환하는 테이블을 만든다. 

첫 번째 `vocab_length`는 **총 단어의 수**를 의미하고, 
두 번째 `vocab_length`는 각 단어를 표현할 **벡터의 크기**를 나타낸다.

예를 들어, 전체 단어가 1,000개이고 각 단어를 100차원의 벡터로 표현하고 싶다면 `nn.Embedding(1000, 100)` 과 같이 설정된다. 이렇게 하면 각 단어마다 100개의 숫자로 이뤄진 고유한 벡터가 할당된다.

이 임베딩 테이블을 통해 텍스트 데이터를 컴퓨터가 이해하고 처리할 수 있는 형태로 변환할 수 있다. 이러한 과정을 거쳐 컴퓨터는 텍스트 데이터를 효과적으로 분석하고 처리할 수 있게 된다.

이러한 **임베딩 과정이 중요한 이유**는 다음과 같다.

1. 컴퓨터는 원래 숫자만을 이해하고 처리할 수 있어 임베딩을 통해 단어를 숫자 벡터로 변환하면 컴퓨터가 이해할 수 있는 형태가 된다.

2. 벡터 표현은 단어 간의 의미적 관계를 수학적으로 표현할 수 있게 해 컴퓨터가 단어간의 유사성을 계산하고 이해할 수 있게 된다.

3. 이러한 벡터 표현은 다양한 수학적 연산을 가능하게 해 복잡한 언어 모델링과 자연어 처리 작업에 유용하다.

4. 고차원 벡터로의 변환은 단어의 다양한 특성을 표현할 수 있어 단어의 복잡한 의미와 뉘앙스를 더 정확히 나타날 수 있다.

모델의 `forward` 메서드는 실제로 데이터가 모델을 통과하는 과정이다. 이 메서드에서는 입력 토큰에 대한 임베딩을 조회한다. 그 결과로 `로짓(logit)`을 반환하는데, **로짓은 확률로 변환되기 전의 원시 점수 값**이다.
이 로짓은 각 가능한 출력 클래스에 대한 상대적인 점수를 나타내며, **일반적으로 소프트맥스 함수를 통해 확률로 변환된다.**

> `Torch와 torch.nn` :  파이토치의 핵심 라이브러리인 torch는 텐서 연산과 자동 미분 기능 등을 제공해 딥러닝 모델 구현에 필수적인 기능을 제공한다. 신경망 구축에 필요한 다양한 레이어와 매개변수 관리 기능은 `torch.nn` 모듈에서 제공한다. 이를 통해 모델 아키텍처를 정의하고 매개변수를 초기화하며, 순전파(forward pass) 를 구현할 수 있다.

> `torch.nn.functional` : 주로 상태가 없는(stateless) 함수들을 제공한다. 여기에는 활성화 함수(ReLU, Sigmoid 등)와 손실 함수(Cross Entropy Loss 등)가 포함된다. 이 모듈은 함수적 인터페이스를 통해 레이어의 작동을 구현할 때 활용한다.


위 코드로는 모델이 학습될 수 없다. 중요한 요소가 하나 빠졌는데, 바로 손실 계산이다. 이제 손실을 구하는 코드를 추가해 보겠다.

Loss를 사용할 때 2가지 중요한 가정이 있다.

**가정1: 전체 손실은 개별 샘플 손실의 합과 같다.**
**가정2: 각 샘플의 손실을 계산할 때 신경망의 최종 출력값과 입력값만 사용한다.**

사용할 손실 함수는 이러한 가정을 충족하는 파이토치의 크로스 엔트로피(cross_entropy)이다.
크로스 엔트로피 함수는 분류 문제에서 모델 성능을 측정하는 데 자주 사용된다.
이 함수는 모델이 예측한 확률 분포(임베딩)와 실제 레이블(target) 분포 간의 차이를 계산한다.

손실이 낮을수록 모델의 예측이 실제 레이블에 더 가깝다는 것을 의미한다. 이러한 손실 계산은 모델이 학습 과정에서 자신의 성능을 평가하고 개선할 수 있게 해주는 중요한 지표가 된다. 손실 함수를 통해 모델은 자신의 예측과 실제 정답 사이의 오차를 인식하고, 이를 최소화하는 방향으로 파라미터를 조정할 수 있다.

손실 함수를 설정하고 다시 한번 코드를 실행해보겠다.

```python
import torch
import torch.nn as nn
from torch.nn import functional as F

class semiGPT(nn.Module):
	def __init__(self, vocab_length):
		super().__init__()
		self.embedding_token_table = nn.Embedding(vocab_length, vocab_length)
	
	def forward(self, inputs, targets=None):
		logits = self.embedding_token_table(inputs)
		
		# 손실 계산 (targets가 제공된 경우에만)
		if targets is not None:
			loss = F.cross_entropy(logits, targets)
			return logits, loss
		else:
			return logits

model = semiGPT(ko_vocab_size)
output, loss = model(example_x, example_y)
print(f"Output shape: {output.shape}, Loss: {loss}")
```

코드를 실행하면 에러를 발생하는 것이 정상이다. 이는 `shape` 가 맞지 않기 때문이다.
이 또한 다양한 연구를 하다 보면 자주 만나는 오류여서 예제로 가져왔다.

> RuntimeError: Expected target size [4, 2701], got[4, 8]

오류가 발생하는 이유를 다시 살펴보겠다. 오류 메시지에서 볼 수 있듯이, 모델은 target size[4, 2701]을 기대하지만, 실제 targets shape으로는 [4, 8]을 받았다는 에러이다. 이는 vacab_length가 2701임을 나타낸다.

example_x, example_y는 각각 [4, 8] 크기이므로 모델에서 크로스엔트로피 손실 함수가 올바르게 작동하려면 **예측한 것(logits)과 실제 값(targets)의 차이를 계산하기 전에 shape 을 조정해야 한다.**

- logits의 shape [4, 8, 2701]에서 [32 2701]로 변경한다. (4x8 = 32)
- targets의 shape을 [4, 8]에서 [32]로 변경한다.

이렇게 shape을 변경함으로써 각 토큰에 대한 예측과 실제 값을 일대일로 비교할 수 있게 된다.

수정된 코드는 다음과 같다.

```python
import torch
import torch.nn as nn
from torch.nn import functional as F

class semiGPT(nn.Module):
	def __init__(self, vocab_length):
		super().__init__()
		self.embedding_token_table = nn.Embedding(vocab_length, vocab_length)
	
	def forward(self, inputs, targets=None):
		# 입력을 임베딩으로 변환
		logits = self.embedding_token_table(inputs)
		
		if targets is not None:
			# 손실 계산을 위해 shape 조정
			batch, seq_length, vocab_length = logits.shape
			logits_reshaped = logits.view(batch * seq_length, vocab_length)
			targets_reshaped = targets.view(batch * seq_length)
			loss = F.cross_entropy(logits_reshaped, targets_reshaped)
			return logits, loss
		else:
			return logits

model = semiGPT(ko_vocab_size)
output, loss = model(example_x, example_y)
print(f"Loss: {loss}")
```

> 실행 결과
> tensor(**8.2693**, grad_fn=NllLossBackward0)

첫 번째로 logits의 shape를 변경했다.
```logits = logits.view(batch * seq_length, vocab)```

이 코드는 원래 [4, 8, 2701] 형태의 logits를 [32, 2701] 형태로 변경한다. 여기서 32는 4(batch) * 8(seq_length)이다. view 함수는 텐서의 모양을 변경하는 파이토치 메서드로 이는 마치 같은 데이터를 다른 방식으로 보는 것처럼 만드는 효과가 있다.

두 번째로 targets의 shape를 변경해 logits와 연산될 수 있도록 만든다.
```targets = targets.view(batch*seq_length)```

이 코드는 원래 [4, 8] 형태의 targets를 [32] 형태로 변경한다. 이렇게 수정하면 이전에 발생했던 shape 불일치 에러가 해결되고, 모델이 정상적으로 손실을 계산할 수 있게 된다.

>한 가지 궁금한 점은 손실값이 8.2693으로 나온 이유이다. 이를 이해하려면 먼저 정보 이론에 대한 기본적인 이해가 필요하다. 정보 이론의 핵심 개념 중 하나는 정보 엔트로피로, 이는 메시지에 포함된 정보의 양을 측정한다. 이런한 정보 이론에 따르면, 이벤트의 정보량은 해당 이벤트 확률의 음의 로그값으로 정의되고, 이는 이벤트가 발생 가능성이 낮을수록 더 많은 정보를 담고 있다는 개념을 반영한다. 이번 실험의 경우, 2701개의 가능한 어휘 요소 중 하나를 정확히 예측해야 하는 상황에서 각 예측의 확률은 1/2701이다.
>
>따라서 -ln(1/2701) = 7.901이라는 값은 완벽한 예측을 위해 필요한 최소 정보량을 나타낸다. 실제 손실값 8.2693이 이 이론적 최솟값보다 높다는 것은 모델이 완벽하지 않으며, 일부 잘못된 예측을 한다는 것을 의미한다. 이 차이는 모델의 현재 성능과 이상적인 성능 사이의 격차를 보여주며, 추가적인 훈련이나 조정을 통해 성능을 개선할 여지가 있음을 알려준다.
>
>이처럼 정보 이론의 개념을 적용하면 모델이 정보를 학습하고 예측 효과를 수학적으로 분석할 수 있다. 그러나 정보 이론에 근거해 학습을 수행하더라도 원하는 성능이 나오지 않을 수 있다. 이는 인공지능이 단순히 정보 처리의 문제만이 아니라 복잡한 요소들이 상호작용하는 다층적 학문이기 때문이다.

## generate 메서드
다음으로 학습한 모델이 예측한 글자를 생성하기 위해 `generate` 메서드를 추가한다. 이 메서드는 모델이 학습한 패턴을 바탕으로 새로운 텍스트를 생성한다. `generate` 메서드는 입력된 시작 문자열에 기반해 연속으로 다음 글자를 예측하고 텍스트를 생성한다.

```python
import torch
import torch.nn
from torch.nn import functional as F

class semiGPT(nn.Moudle):
	def __init__(self, vocab_length):
		super().__init__()
		self.embedding_token_table == nn.Embedding(vocab_lengthm vocab_length)
	
	def forward(self, inputs, targets):
		logits = self.embedding_token_table(inputs)
		batch, seq_length, vecab_length = logits.shape
		logits = logits.view(batch * seq_length, vocab_length)
		targets = targets.view(batch*seq_length)
		loss = F.cross_entropy(logits, targets)
		return logits, loss

	def generate(self, inputs, max_new_tokens):
		for _ in range(max_new_tokens):
			logits, loss = self.forward(inputs)
			logits = logits[:, -1, :]
			print(logits.shape)
			probs = F.softmax(logits, dim-1)
			next_inputs = torch.multionmial(probs, num_samples=1)
		return inputs

model = semiGPT(ko_vocab_size)
outputm loss = model(example_x, example_y)

token_decode(model.generate(torch.zeros((1,1),
							dtype=torch.long),
							max_new_tokens=10)[0].tolist())
```

> 실행결과: 엿입빤쌩슝찮찡펭

먼저, `max_new_tokens` 횟수만큼 반복문을 실행한다. 각 반복에서 현재의 `inputs` 를 forward를 통과시켜 logits와 loss를 얻는다. logits[:, -1, :]을 통해 가장 최근에 생성된 토큰에 대한 로짓만을 선택한다.

```python
import torch

logits = torch.tensor(
	[
		[
			[0.1, 0.2, 0.3, 0.4],
			[0.2, 0.3, 0.4, 0.1],
			[0.3, 0.4, 0.1, 0.2]
		]
	]
)

result = logits[:,-1,:]
print("선택되는 값 : ", result)
print("결과에 대한 size값 : ", result.size())
```

> 실행결과: 
> 선택되는 값 : tensor(0.3000, 0.4000, 0.1000, 0.2000)
> 결과에 대한 size 값: torch.Size([1,4])

예를 들어 아래와 같은 `logits` 텐서가 있다고 합시다.

```python
logits.shape = (batch_size=1, seq_len=3, vocab_size=4)
```

이건 아래와 같은 의미입니다.

- `batch_size=1`: 한 번에 하나의 문장을 생성 중
    
- `seq_len=3`: 지금까지 총 3개의 토큰을 예측함
    
- `vocab_size=4`: 전체 어휘(단어 혹은 문자)가 4개이고, 각각의 토큰에 대해 4개의 로짓 값(다음 단어일 확률 점수 후보)이 있음

**그래서 logits[:, -1, :] 은 무엇인가?**

```python
logits[:, -1, :]
```

이 의미는 "각 배치의 마지막 토큰에 대한 예측 로짓만 뽑겠다" 는 뜻이다.

- `:`: 모든 배치 선택 (여기선 하나니까 0번째 배치)
    
- `-1`: 시퀀스(문장) 중 마지막 토큰 선택
    
- `:`: 그 토큰에 대한 전체 로짓 (어휘 개수만큼) 선택
    

즉, **가장 마지막 토큰 위치에서, 다음 토큰이 무엇일지에 대한 예측 확률을 보고 싶어서 이 부분을 뽑는 것**이다.

 왜 마지막 토큰만 쓰는 걸까?

`generate()` 함수는 **현재까지 입력된 문장을 기반으로 다음 글자 하나를 생성**하는 과정이다.

```python
입력 = "안녕"
```

예를 들어,  `안`, `녕` 각각의 위치에 대해 다음 글자를 예측하지만, 우리는 마지막 글자인 `"녕"` 뒤에 어떤 글자가 나올지를 알고 싶다.

그래서 전체 로짓 중 **마지막 글자의 로짓만 추출해서**

```python
logits = logits[:, -1, :]  # => (batch, vocab_size)
```

이걸 softmax 후 multinomial sampling을 통해 다음 글자 하나를 샘플링합니다.

요약하자면 `logits[:, -1, :]`는 **지금까지 생성된 문장 중 마지막 글자 위치에서, 다음에 어떤 글자가 나올지 예측한 확률 값(logits)을 뽑기 위한 연산**입니다.

필요하다면 이걸 기반으로 softmax → 샘플링 → 새 토큰 생성 → 이어 붙이기를 반복합니다.


##  Optimizer 추가하기
모델 훈련 시 손실 함수를 이용해 모델의 예측 값과 실제 정답 데이터 사이의 차이(손실)를 계산하고, 이 손실을 최소화하기 위해 모델의 매개변수를 적절하게 조정한다. 옵티마이저는 이 매개변수 조정 과정을 담당해 모델이 더 정확한 예측을 할 수 있도록 내부 구조를 지속적으로 개선한다. 이러한 과정을 통해 모델은 주어진 데이터에 대해 더 나은 성능을 보이게 된다.

```python
learning_rate = 1e-2
model = semiGPT(ko_vocab_size)
optimizer = torch.optim.AdamW(model.parameter(), lr=learning_rate)
```

모델의 학습을 위해 학습률은 1e-2로 정하고, 옵티마이저로 AdamW를 사용한다.
AdamW는 Adam이라는 기존 옵티마이저를 개선한 버전이다. 이 옵티마이저의 주요 특징은 가중치 감쇠라는 기법을 더 효과적으로 사용한다는 점이다. 가중치 감쇠는 모델이 훈련 데이터에 과도하게 맞춰지는 것을 방지하고, 일반화 능력을 향상시키는 데 도움을 준다.

`torch.optim.AdamW(model.parameter(), lr=learning_rate)` 코드는 파이토치에서 AdamW 옵티마이저를 생성하는 부분이다.

- torch.optim은 파이토치의 최적화 알고리즘 모듈이다. 이 모듈에는 다양한 옵티마이저가 포함되어 있다.
- AdamW는 Adam 옵티마이저의 변형으로, 가중치 감쇠(weghit decay)를 더 효과적으로 처리한다. Adam은 적응형 학습률을 사용하는 최적화 알고리즘이다.
- `model.parameters()` 는 최적화할 모델의 매개변수를 지정한다. 이 메서드는 모델의 모든 학습 가능한 매개변수를 반환하다.
- `lr=learning_rate` 는 학습률을 설정한다. 학습률은 각 반복에서 매개변수를 얼마나 크기 업데이트할지 결정하는 중요한 하이퍼파라미터이다.

해당 코드를 실행하면, 학습 과정에서 이 옵티마이저를 사용해 모델의 가중치를 업데이트하고 손실을 최소화하는 방향으로 학습을 진행한다.

```python
from tqdm.auto import tqdm

batch_size = 32

for steps in tqdm(range(10000)):
	example_x, example_y = batch_function("train")
	logits, loss = model(example_x, example_y)
	# 옵티마이저 초기화
	optimizer.zero_grad(set_to_none=True)
	# 역전파 계산
	loss.backward()
	# 가중치 업데이트
	optimizer.step()

print(loss.item())
```

> 실행결과: 3.477691411972046

먼저 배치 크기를 32로 설정한다. 그 다음 각 반복마다 학습 데이터에서 배치를 가져와 모델에 입력한다. 모델은 이 입력을 처리해 예측값(logits)과 손실값(loss)을 계산한다.

옵티마이저가 정해지면 가중치를 업데이트하기 위해 세 가지 중요한 단계를 거친다.

- **옵티마이저 초기화**: `optimizer.zero_grad(set_to_none=True)` 를 사용해 옵티마이저의 그레이디언트 버퍼를 초기화한다. 이는 새로운 배치 처리 전 이전 그레이디언트의 영향을 제거하기 위함이다.
- **역전파 계산**: `loss_backward()` 를 통해 손실 함수의 그레이디언트를 계산한다. 이 과정에서 모델의 각 가중치에 대한 손실 함수의 변화율을 구한다.
- **가중치 업데이트**: `optimizer.step()`을 사용해 계산된 그레이디언트를 바탕으로 모델의 가중치를 실제로 업데이트한다.

마지막으로, 현재 반복에서의 손실값을 출력한다. 이 과정을 통해 모델은 점진적으로 학습 데이터에 맞춰 개선되며, 특정 작업이나 도메인에 더욱 적합한 성능을 보이게 된다.

> 옵티마이저 추가 전 생성 결과: 엿입빤쌩슝찮찡펭

> 옵티마이저 추가 후 생성 결과: 협력에 오를 것이

옵티마이저를 추가한 후 생성된 결과는 "협력에 오를 것이"라는 한국어 문장의 일부분이 생성되었다. 이는 옵티마이저가 모델의 학습 과정을 효과적으로 개선해 더 자연스러운 텍스트를 생성할 수 있게 만들었음을 보여준다.


## 데이터를 GPU로 전달하기

지금까지는 CPU로 학습했는데, 이제 GPU를 이용해 학습해 보겠다. GPU를 이용해 학습하려면 데이터와 모델을 반드시 GPU로 전송해야 한다. 이를 위해 파이토치에서는 `to` 메서드를 제공한다. `to(device)` 명령어를 사용하면 데이터와 모델을 간편하게 GPU로 전송해 GPU 연산을 수행할 수 있다. 먼저 다음은 `device` 변수를 설정하고, 이를 통해 데이터와 모델을 GPU로 이동하는 과정이다.

```python
device = "cuda" if torch.cuda.is_available() else "cpu"
```

`torch.cuda.is_available()` 함수를 사용해 현재 실행 환경에서 CUDA 사용 가능 여부를 확인한다.
CUDA는 엔비디아의 GPU를 활용해 딥러닝 연산을 가속화하는 툴킷(toolkit)이다. 이 기능을 통해 GPU의 강력한 병렬 처리 능력을 활용해 딥러닝 모델의 학습 속도를 크게 향상 시킬 수 있다.

```python
def batch_function(mode):
	dataset = train_dataset if mode == "train" else test_dataset
	idx = torch.randint(len(dataset) - block_size, (batch_size,))
	x = torch.stack([dataset[index:index+block_size] for index in idx])
	y = torch.stack([dataset[index+1:index+block_size+1] for index in idx])
	x, y = x.to(device), y.to(device)
	return x, y
```

앞서 준비한 `batch_function` 함수에 CUDA를 사용할 수 있는 환경에서 GPU를 활용해 연산을 수행하도록 수정한다. 이를 위해 입력 데이터 (x)와 목표 데이터 (y)를 동시에 `device`로 이동한다. CUDA 환경이 준비돼 있다면 이러한 방식으로 데이터를 GPU로 전송해 처리 속도를 크게 향상할 수 있다.

## Loss 함수 만들기
다음은 `calculate_loss` 함수이다. 모델이 제대로 학습하고 있는지 확인하기 위해 이 함수를 만들어 중간중간 평가해 보겠다.

```python
@torch.no_grad()
def compute_loss_metrics():
	out = {}
	model.eval()
	for mode in ["train", "eval"]:
		losses = torch.zeros(eval_iteration)
		for k in range(eval_iteration):
			inputs, targets = batch_function(mode)
			logits, loss = model(inputs, targets)
			losses[k] = loss.item()
		out[mode] = losses.mean()
	model.train()
	return out
```

`@torch.no_grad()` 데코레이터는 파이토치에서 중요한 기능을 수행한다. 이 데코레이터를 함수 위에 붙이면 해당 함수 내에서 이뤄지는 모든 연산에 대해 그레이디언트 계산을 자동으로 비활성화한다.

일반적으로 딥러닝 모델을 학습할 때는 역전파(backpropagation)를 통해 그레이디언트를 계산하고, 이를 바탕으로 모델의 가중치를 업데이트한다. 하지만 모델을 평가하는 단계에서는 이러한 그레이디언트 계산과 가중치 업데이트가 필요하지 않는다.

그레이디언트 계산을 비활성화하면, 
1. 그레이디언트 정보를 저장할 필요가 없어 메모리 사용량이 줄어든다.
2. 그레이디언트 계산 과정이 생략되므로 전체적으로 계산 속도가 빨라진다.

그 다음 `model.eval()` 명령은 신경망 모델을 평가 모드로 전환하는 중요한 단계이다. 이 설정은 **모델의 특정 레이어들이 학습 과정과 평가 과정에서 다르게 작동**해야 할 때 필수적이다.

예를 들어, 드롭아웃(Dropout) 레이어는 학습 중에는 무작위로 일부 뉴런을 비활성화해 과적합을 방지한다. 하지만 평가 시에는 모든 뉴런을 사용해야 더 안정적인 예측이 가능하다. `eval()` 모드에서는 드롭아웃이 자동으로 비활성화된다.

또한, `model.eval()` 은 배치 정규화 레이어도 학습과 평가 시 다르게 작동해야 한다. 학습 중에는 통계를 사용하지만, 평가 시에는 전체 데이터셋에서 계산된 누적 통계를 사용한다. `eval()` 모드는 이러한 전환을 자동으로 처리 한다.

그 다음, train과 eval 두 가지 모드에 대해 반복한다. 각 모드에서 eval_iteration 횟수만큼 반복하며 손실을 계산한다. `batch_function(mode)` 함수로 데이터 배치를 가져오고, `model(inputs, targets)` 로 로짓과 손실을 계산한다. 계산된 손실은 losses 텐서에 저장한다. 각 모드에서 계산된 손실들의 평균을 구해 `out` 딕셔러리에 저장한다. 이 평균 손실은 각 모드에서 모델 성능을 나타내는 지표로 사용된다.

학습 중간중간 실행되는 `comput_loss_metrics` 함수의 실행이 끝나면 `model.train()` 으로 모델을 다시 훈련 모드로 전환해 이후 모델을 계속 훈련할 수 있도록 설정한다. 마지막으로, train과 eval 모드의 평균 손실값을 포함한 out 딕셔러리를 반환한다. 이 딕셔너리는 모델의 현재 학습 상태를 평가하는 데 사용되며, 훈련과 평가 데이터 모두에 대한 모델의 성능을 한눈에 볼 수 있게 해준다.

```python
for step in range(max_iteration):
	if step % eval_interval == 0:
		losses = compute_loss_metrics()
		print(f'step : {step}, train loss : {losses["train"]: .4f}, val loss : {losses["eval"]: .4f}')

	example_x, example_y = batch_function("train")
	logits, loss = model(example_x, example_y)
	optimizer.zero_grad(set_to_none=True)
	loss.backward()
	optimizer.step()


inputs = torch.zeros((1,1), dtype=toch.long, device=device)
print(token_decode(model.generate(inputs, max_new_tokens=100)[0].tolist()))
```

> 실행결과:
> step: 49500, train loss : 3.3963, val loss : 3.4179
> step: 49800, train loss : 3.3909, val loss : 3.4089
> 등 온 차등 일부회사업이다. 9%로나 첫 국민 서 백 교섭5월말했던 카카페이다리

위 코드를 실행하면 모델이 일정 간격으로 학습 손실과 검증 손실을 계산하고 출력하는 과정을 반복한다.
`max_iteration` 은 모델이 수행할 최대 반복 횟수를 의미하며, `eval_interval` 은 평가를 수행할 간격을 나타낸다.

- `max_iteration` 만큼 반복을 수행하는 for 루프를 통해 모델 학습을 진행한다.
  
- 각 반복에서 `step` 변수는 현재 반복의 번호를 나타낸다. `step % eval_interval == 0` 조건문은 현재 반복 번호가 eval_interval 로 정확히 나눠떨어질 때, 즉 지정된 평가 간격마다 참이 된다. 이때 `compute_loss_metrics()` 함수를 호출해 현재 모델의 학습 손실과 검증 손실을 계산한다. 이 함수는 학습 데이터와 검증 데이터에 대해 모델을 평가하고 각 평균 손실값을 계산해 반환한다.
  
- losses 딕셔너리에는 train과 eval 키를 통해 접근할 수 있는 학습 손실과 검증 손실 값을 저장한다. 이후 print 함수로 현재 단계(step), 학습 손실(losses["train"]), 그리고 검증 손실(losses["eval"])을 출력한다. 이를 통해 학습 과정 진행 상황을 모니터링하고 모델이 학습 데이터와 검증 데이터에 대해 얼마나 잘 작동하는 지 평가할 수 있다.
  
- `batch_function` 함수를 사용해 학습 데이터에서 미니배치를 추출한다. 모델에 입력 데이터(example_x)와 정답 데이터(example_y)를 전달해 예측값과 손실값을 계산한다. 그 다음 역전파를 수행하고 옵티마이저를 사용해 모델의 파라미터를 업데이트한다.

- 학습이 완료된 후, 모델을 사용해 새로운 텍스트를 생성한다. 입력으로 0으로 채워진 텐서를 사용하고, 모델의 `generate` 메서드를 호출해 최대 100개의 새로운 토큰을 생성한다. 생성된 토큰은 `token_decode` 함수를 사용해 텍스트로 변환되어 출력된다.

- 이 코드를 모두 종합해 `optimizer` 를 적용한 전체 코드이다. 오류가 발생하거나 중간에 문제가 생겼을 때는 세션을 초기화하고 코드를 다시 실행하면 일괄적으로 작동하도록 구성했다.

이 실습 결과에서도 드러나듯, 초창기 언어 모델은 문맥 이해와 의미 있는 단어 생성에 어려움을 겪었다. 연구자들은 이러한 문제를 해결하려고 단어 간 연관성을 학습하는 RNN, GRU, LSTM 등 다양한 신경망 구조를 연구했다. 

구글 개발자들은 **RNN과 LSTM이 가진 장기 의존성 문제, 순차적 처리로 인한 병렬 처리의 어려움, 그리고 긴 시퀀스를 처리할 때 발생하는 그레이디언트 소실 또는 폭발 문제로 인한 연산 비용 증가와 같은 기존 순차 처리 방식의 한계를 극복하고자**, 어텐션 메커니즘을 중심으로 한 새로운 모델 아키텍처인 트랜스포머를 제안했다.

트랜스포머는 이러한 문제를 해결하기 위해 오직 어텐션 메커니즘만을 사용해 모델을 구성한다. 논문에 소개된 아이디어는 cross attention, masked self attention, self attention 메커니즘을 핵심으로 한다. 이 메커니즘은 **입력 시퀀스의 각 요소가 다른 모든 요소와 어떻게 관련되는지 병렬로 계산**한다. 따라서 **입력 시퀀스 내 모든 위치 간의 관계를 효율적으로 모델링**할 수 있게 된다. 이를 통해 **트랜스포머는 데이터의 긴 범위 의존성을 더 효과적으로 학습**하고, 병렬 처리로 인해 빠른 학습과  추론 속도를 달성한다.

결과적으로 트랜스포머는 자연어 처리(NLP) 분야에서 혁신적인 발전으로 인정받으며, BERT, GPT 등 다양한 변형 모델의 기반이 된다. 또한 텍스트 이해와 생성 작업에서 뛰어난 성능을 보여 지금도 널리 사용된다.

GPT 모델에는 여러 가지 중요한 기술이 적용된다. masked attention, multi head attention, positional Encoding, 전차 연결, 레이어 정규화, dropopt 등이 있다. 이제 이러한 기법들을 모델에 단계적으로 적용하며 학습에 어떤 영향을 주는지 살펴보겠다.