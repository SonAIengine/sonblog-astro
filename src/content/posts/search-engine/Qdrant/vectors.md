---
title: Qdrant Vectors — Dense, Sparse, Multivector 벡터 유형 가이드
description: Qdrant에서 사용하는 벡터의 개념과 유형을 정리한다. Dense Vector, Sparse Vector, Named Vector,
  Multivector의 차이와 각 유형의 설정 방법, 양자화(Quantization) 옵션을 다룬다.
pubDatetime: 2025-07-15
tags:
- Qdrant
- 벡터검색
- 검색엔진
- Dense Vector
- Sparse Vector
- 양자화
- Search Engine
---


Qdrant는 벡터 기반 검색 엔진으로, 모든 검색 연산의 핵심은 벡터(또는 임베딩)이다. 벡터는 객체 간의 유사도를 수치화하여 벡터 공간 상의 거리로 비교할 수 있도록 한다. 

이 글에서는 Qdrant에서 사용되는 벡터의 개념과 구조, 그리고 다양한 벡터 유형에 대해 설명한다.


## 벡터란 무엇인가

벡터는 객체를 고정된 차원의 수치 배열로 변환한 표현이다. 일반적으로 신경망(Neural Network)을 통해 객체(텍스트, 이미지 등)를 벡터화하게 되며, 이 벡터는 객체의 의미나 특성을 압축적으로 담고 있다.

예를 들어, 이미지 컬렉션이 있다고 가정할 때 각 이미지를 벡터로 변환하면, 시각적으로 유사한 이미지는 벡터 공간 상에서도 서로 가까운 위치에 놓이게 된다.

신경망은 보통 유사한 객체 쌍(또는 삼중쌍)을 학습 데이터로 하여, 의미상 유사한 입력은 가까운 벡터로, 다른 입력은 멀어진 벡터로 맵핑되도록 훈련된다.

이러한 성질을 활용하여 유사 검색, 군집화, 이상 탐지 등의 다양한 데이터 탐색이 가능해진다.


## 벡터의 종류

Qdrant는 현대의 임베딩 모델들이 생성하는 다양한 형태의 벡터를 지원한다.

### 1. Dense Vector

Dense Vector는 가장 일반적인 형태의 벡터로, 고정된 길이의 부동소수점(float) 숫자 배열이다.

```json
[
  -0.013, 0.020, -0.007, -0.111, ...
]
```

대부분의 임베딩 모델은 Dense Vector를 출력하므로 별도의 전처리 없이 Qdrant에 직접 사용할 수 있다.


### 2. Sparse Vector

Sparse Vector는 대부분의 값이 0인 희소 벡터이다. 수학적으로는 Dense Vector와 동일하나 저장과 인덱싱 방식이 다르다.

Qdrant에서 Sparse Vector는 다음과 같이 (index, value) 쌍의 배열로 표현된다.

```json
{
  "indices": [1, 3, 5, 7],
  "values": [0.1, 0.2, 0.3, 0.4]
}
```

Sparse Vector는 별도의 저장소와 인덱스로 관리되므로 Dense Vector와는 별도로 설정해야 한다.

컬렉션 생성 시 다음과 같이 정의할 수 있다.

```json
{
  "sparse_vectors": {
    "text": {}
  }
}
```


### 3. MultiVector

Qdrant는 하나의 포인트에 다수의 Dense Vector를 배열 형태로 저장할 수 있는 MultiVector를 지원한다. 이는 고정된 벡터 크기를 가지며, 포인트마다 서로 다른 개수의 벡터를 저장할 수 있다.

```json
"vector": [
  [-0.013, 0.020, -0.007, -0.111],
  [-0.030, -0.055, 0.001, 0.072],
  [-0.041, 0.014, -0.032, -0.062]
]
```

주로 다음과 같은 시나리오에서 사용된다.

- 하나의 객체에 대해 다양한 시점/각도의 표현이 필요한 경우
    
- ColBERT 등 Late Interaction 방식의 텍스트 임베딩 모델 사용 시
    

MultiVector를 사용하려면 컬렉션 생성 시 `multivector_config`를 정의해야 하며, 현재는 `max_sim` 비교 함수를 지원한다.

```json
{
  "vectors": {
    "size": 128,
    "distance": "Cosine",
    "multivector_config": {
      "comparator": "max_sim"
    }
  }
}
```

### 4. Named Vectors

Qdrant에서는 포인트당 여러 개의 벡터를 이름(Named)을 붙여 구분할 수 있다. 예를 들어 이미지 벡터와 텍스트 벡터를 동시에 저장하고 검색할 수 있다.

```json
{
  "vectors": {
    "image": {
      "size": 4,
      "distance": "Dot"
    },
    "text": {
      "size": 5,
      "distance": "Cosine"
    }
  },
  "sparse_vectors": {
    "text-sparse": {}
  }
}
```

포인트 삽입 시에도 각각의 이름으로 구분하여 벡터를 저장한다.

```json
{
  "id": 1,
  "vector": {
    "image": [0.9, 0.1, 0.1, 0.2],
    "text": [0.4, 0.7, 0.1, 0.8, 0.1],
    "text-sparse": {
      "indices": [1, 3, 5, 7],
      "values": [0.1, 0.2, 0.3, 0.4]
    }
  }
}
```


## 벡터 데이터 타입

Qdrant는 벡터의 정밀도와 메모리 사용량을 고려하여 다양한 **데이터 타입**을 지원한다.

| 데이터 타입        | 설명                                           |
| ------------- | -------------------------------------------- |
| float32 (기본값) | 32비트 부동소수점, 대부분의 임베딩에 적합                     |
| float16       | 절반 크기의 메모리 사용, 정밀도 손실은 미미                    |
| uint8         | 0~255 범위의 정수형, 양자화(Quantization)된 벡터 저장 시 사용 |

### 예: float16 사용 설정

```json
{
  "vectors": {
    "size": 128,
    "distance": "Cosine",
    "datatype": "float16"
  },
  "sparse_vectors": {
    "text": {
      "index": {
        "datatype": "float16"
      }
    }
  }
}
```

### 예: uint8 사용 설정

```json
{
  "vectors": {
    "size": 128,
    "distance": "Cosine",
    "datatype": "uint8"
  },
  "sparse_vectors": {
    "text": {
      "index": {
        "datatype": "uint8"
      }
    }
  }
}
```


## 벡터 양자화 (Quantization)

벡터의 데이터 타입 변경 외에도, Qdrant는 **양자화된(Quantized)** 벡터를 원본 벡터와 함께 생성할 수 있다. 이 양자화 벡터는 후보를 빠르게 추려내는 데 사용되거나, 경우에 따라 직접 검색에도 사용될 수 있다.

양자화는 자동 최적화(optimization) 단계에서 백그라운드로 수행된다.


## 벡터 저장 방식

Qdrant는 벡터 저장 위치를 메모리 또는 디스크 중 선택할 수 있다. RAM 기반 저장은 빠른 검색 속도를 보장하지만, 디스크 저장은 메모리 사용량을 줄일 수 있다.

구체적인 벡터 저장 전략은 저장 설정(Storage section)에서 추가로 설정할 수 있다.


## 마무리

Qdrant는 다양한 유형의 벡터와 데이터 타입을 지원하여 텍스트, 이미지, 멀티모달 데이터 등 복합적인 벡터 표현을 유연하게 다룰 수 있도록 설계되어 있다. 

Dense, Sparse, MultiVector 등 목적에 맞는 벡터 구조를 선택하고, float16, uint8 등의 데이터 타입과 조합하면 성능과 리소스 효율성을 극대화할 수 있다.

Qdrant를 도입한 벡터 검색 시스템을 구축할 때, 벡터 구성과 저장 전략을 적절히 선택하는 것이 매우 중요한 설계 포인트가 될 수 있다.