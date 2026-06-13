---
title: 파이썬 multiprocessing - 병렬 처리로 성능 향상하기
description: 파이썬 multiprocessing 모듈을 활용한 프로세스/스레드 기반 병렬 처리를 다룬다. 몬테 카를로 원주율 추정, Pool
  기반 소수 검색, Queue와 포이즌 필을 통한 작업자 관리까지 실전 예제를 정리한다.
pubDatetime: 2024-09-30
tags:
- Python
- multiprocessing
- 병렬처리
- GIL
- 성능최적화
- Full Stack
---


파이썬의 `multiprocessing` 모듈은 프로세스와 스레드 기반의 병렬화를 위한 저수준 인터페이스를 제공한다.

먼저 프로세스나 스레드 풀을 활용하는 몬테 카를로 방식을 사용해 원주율을 추정할 것이다.
이 문제는 단순하며 복잡도도 잘 알려져 있으므로 병렬화가 쉽다.
또한 numpy를 사용할 때 예기치 못한 결과를 볼 수 있다.

그 다음에는 Pool 방식을 사용해서 소수를 찾는다. 소수를 찾는 과정의 예측 불가능한 복잡성을 살펴보고, 어떻게 해야 부하를 효율적으로(또는 비효율적으로!) 분산시켜서 계산 자원을 가장 잘 활용할 수 있는지 살펴본다.
큐를 다루면서 소수 검색을 마칠 것이다. 그 과정에서 Pool 대신 Process 객체를 사용하고, 작업 목록과 포이즌 필을 활용해서 각 작업자의 생명주기를 조정해보자.

---

## 몬테 카를로 방식을 사용해 원주율 추정하기

반지름이 1인 단위원으로 표현되는 “다트 판”에 가상의 다트를 수천 번 던져서 원주율을 추정할 수 있다.
원주와 그 내부에 떨어진 다트의 개수 사이의 관계를 사용해서 원주율을 추산한다.

이는 이상적으로 프로세스에 전체 부하를 균등하게 나눌 수 있는 첫 번째 문제이다.
각 프로세스는 별도의 cpu에서 작동한다. 부하가 같으니 모든 프로세스는 같은 시간에 끝날 것이다.
따라서 이 문제에 새로운 CPU나 하이퍼스레드를 추가하면 속도가 빨라진다.

스레드를 하나만 사용하면 56초 걸리고, 스레드가 둘 이상이어도 속도가 빨라지지 않는다.
프로세스를 둘 이상 사용하면 실행 시간을 더 짧게 만들 수 있다.

2개나 4개의 코어를 활용할 때 선형적인 속도 향상을 얻었지만, 노트북에 물리적 코어가 4개밖에 없으므로 프로세스를 8개 사용하더라도 추가로 얻는 속도 향상은 거의 없다.

스레드를 사용하면 각 명령은 GIL 때문에 제약이 걸린다. 따라서 각 스레드를 별도의 CPU에 실행할 수 있음에도 불구하고, 다른 스레드가 실행 중이지 않을 때만 실행한다.

프로세스를 사용하는 버전은 이런 제약이 없다. 각 프로세스가 단일 스레드를 실행하는 별도의 파이썬 인터프리터이니 공유 객체로 인한 GIL 경쟁이 없다.

```python
from random import uniform
from multiprocessing import Pool
import time
import matplotlib.pyplot as plt

def estimate_circle(nbr_estimates):
	nbr_trials_in_quarter_unit_circle = 0
	for step in range(int(nbr_estimates)):
		x = uniform(0, 1)
		y = uniform(0, 1)
		is_in_unit_circle = x * x + y * y < 1.0
		nbr_trials_in_quarter_unit_circle += is_in_unit_circle

	return nbr_trials_in_quarter_unit_circle

def run_simulation(nbr_parallel_blocks, nbr_samples_in_total=1e8):
	pool = Pool(processes=nbr_parallel_blocks)
	nbr_samples_per_worker = nbr_samples_in_total / nbr_parallel_blocks
	nbr_trials_in_quarter_unit_circle = pool.map(estimate_circle, [nbr_samples_per_worker] * nbr_parallel_blocks)

	pool.close()
	pool.join()

	# 병렬로 실행된 결과를 종합해서 총 원 안에 있는 점들의 개수 계산
	total_nbr_trials_in_quarter_unit_circle = sum(nbr_trials_in_quarter_unit_circle)

	# 원주율 추정 (1/4 원에 해당하므로 4배 곱)
	estimated_pi = 4 * total_nbr_trials_in_quarter_unit_circle / nbr_samples_in_total
	return estimated_pi

if __name__ == "__main__":
	nbr_samples_in_total = 1e8  # 총 시뮬레이션 샘플 수

	process_counts = range(1, 11)  # 1부터 10까지의 프로세스 수
	computation_times = []  # 각 프로세스 수에 따른 계산 시간 저장

	for nbr_parallel_blocks in process_counts:
		start_time = time.time()  # 시작 시간 기록
		estimated_pi = run_simulation(nbr_parallel_blocks, nbr_samples_in_total)
		end_time = time.time()    # 종료 시간 기록

		total_time = end_time - start_time
		computation_times.append(total_time)  # 계산 시간 저장

		print(f"Processes: {nbr_parallel_blocks}, Estimated Pi: {estimated_pi}, Time: {total_time:.2f} seconds")

	# 계산 시간 그래프 출력
	plt.figure(figsize=(10, 6))
	plt.plot(process_counts, computation_times, marker='o', linestyle='-', color='b')
	plt.title("Computation Time vs Number of Processes")
	plt.xlabel("Number of Processes")
	plt.ylabel("Computation Time (seconds)")
	plt.grid(True)
	plt.show()

```
![Image](https://ifh.cc/g/Zp0qNF.png)

---

## multiprocessing 을 Joblib 으로 바꾸기

Joblib은 multiprocessing을 개선한 모듈로 경량 파이프라이닝을 활성화하면서 병렬 계산을 쉽게 하고,
결과를 쉽게 디스크 기반의 캐시로 사용할 있다.

다음과 같은 경우 Joblib을 사용하면 쉽게 성능을 높일 수 있다.

- 당황스러울 정도로 병렬적인 루프를 처리하는 데 순수 파이썬을 사용 중이다.(넘파이 여부는 상관 x)
- 출력을 디스크에 저장해 세션과 세션 사이에 결과를 캐시할 수 있는데도, 부작용없이 비용이 많이 드는 함수를 호출한다.
- 프로세스 사이에 넘파이를 공유할 수 있지만 어떻게 하는지를 모른다.

```python
from random import uniform
from joblib import Parallel, delayed
import time
import matplotlib.pyplot as plt

def estimate_circle(nbr_estimates):
	nbr_trials_in_quarter_unit_circle = 0
	for step in range(int(nbr_estimates)):
		x = uniform(0, 1)
		y = uniform(0, 1)
		is_in_unit_circle = x * x + y * y < 1.0
		nbr_trials_in_quarter_unit_circle += is_in_unit_circle

	return nbr_trials_in_quarter_unit_circle

def run_simulation(nbr_parallel_blocks, nbr_samples_in_total=1e8):
	nbr_samples_per_worker = nbr_samples_in_total / nbr_parallel_blocks
	# Parallel과 delayed를 사용하여 작업 병렬화
	nbr_trials_in_quarter_unit_circle = Parallel(n_jobs=nbr_parallel_blocks)(
		delayed(estimate_circle)(nbr_samples_per_worker) for _ in range(nbr_parallel_blocks)
	)

	# 병렬로 실행된 결과를 종합해서 총 원 안에 있는 점들의 개수 계산
	total_nbr_trials_in_quarter_unit_circle = sum(nbr_trials_in_quarter_unit_circle)

	# 원주율 추정 (1/4 원에 해당하므로 4배 곱)
	estimated_pi = 4 * total_nbr_trials_in_quarter_unit_circle / nbr_samples_in_total
	return estimated_pi

if __name__ == "__main__":
	nbr_samples_in_total = 1e8  # 총 시뮬레이션 샘플 수

	process_counts = range(1, 11)  # 1부터 10까지의 프로세스 수
	computation_times = []  # 각 프로세스 수에 따른 계산 시간 저장

	for nbr_parallel_blocks in process_counts:
		start_time = time.time()  # 시작 시간 기록
		estimated_pi = run_simulation(nbr_parallel_blocks, nbr_samples_in_total)
		end_time = time.time()    # 종료 시간 기록

		total_time = end_time - start_time
		computation_times.append(total_time)  # 계산 시간 저장

		print(f"Processes: {nbr_parallel_blocks}, Estimated Pi: {estimated_pi}, Time: {total_time:.2f} seconds")

	# 계산 시간 그래프 출력
	plt.figure(figsize=(10, 6))
	plt.plot(process_counts, computation_times, marker='o', linestyle='-', color='b')
	plt.title("Computation Time vs Number of Processes (joblib)")
	plt.xlabel("Number of Processes")
	plt.ylabel("Computation Time (seconds)")
	plt.grid(True)
	plt.show()

```
![Image](https://ifh.cc/g/SzKWya.png)

함수 호출 결과를 똑똑하게 캐시하기

Joblib의 Memory 캐시는 유용한 기능이다. Memory 는 함수 결과를 입력 인자에 따라 디스크 캐시로 저장하는 데커레이터다. 이 캐시는 파이썬 세션 간에 영속적으로 유지되므로, 컴퓨터를 껐다가 다음날 켜서 같은 코드를 다시 실행해도 캐시에 저장한 결과를 사용할 수 있다.

--- 

## 소수 찾기

다음으로, 아주 큰 범위의 수에서 소수를 검사하는 방법을 살펴보자. 전체 범위에서 어느 위치에 있느냐에 따라 부하가 달라지고 여러 수의 소수 여부를 검사하는 작업의 복잡도를 예측할 수 없다는 점에서 원주율 문제와는 성격이 다르다.

소수성을 판별하는 순차적인 함수를 작성하고 가능한 인수의 집합을 각각의 프로세스에 넘겨 검사할 수 있다.
이 문제는 당황스러울 정도로 병렬적이다. 이는 공유해야할 상태가 전혀 없다는 의미이다.

multiprocessing 모듈을 사용하면 부하를 쉽게 제어할 수 있다. 따라서 계산에 필요한 자원을 활용(또는 오용!)하려면 작업 큐를 어떻게 튜닝할 수 있는지를 검토하고, 자원을 조금 더  효율적으로 사용할 수 있는 쉬운 방법을 탐구해 보려 한다.

즉 미리 정해진 자원 집합에 복잡도가 달라지는 여러 작업을 효율적으로 배분해서 부하를 균등화할 방법을 살펴볼 것이다.

```jsx
import math
import time
import matplotlib.pyplot as plt

def check_prime(n):
	if n < 2:  # 1은 소수가 아니므로 False 처리
		return False
	if n % 2 == 0:
		return n == 2  # 2는 유일한 짝수 소수이므로 예외 처리
	for i in range(3, int(math.sqrt(n) + 1), 2):
		if n % i == 0:
			return False
	return True

# 범위를 지정하고 각 범위에서 걸리는 시간을 기록
start_range = 10000
end_range = 1000000
step = 10000

numbers = range(start_range, end_range + 1, step)
times = []

# 각 숫자 범위 내의 모든 수에 대해 소수 판별하는 데 걸린 시간 측정
for number in numbers:
	start_time = time.time()

	# 1부터 해당 숫자 범위까지의 모든 소수 판별
	primes = [n for n in range(1, number + 1) if check_prime(n)]

	end_time = time.time()

	elapsed_time = end_time - start_time
	times.append(elapsed_time)

# 걸린 시간에 따른 그래프 그리기
plt.plot(numbers, times, label='Prime Check Time')
plt.xlabel('Number')
plt.ylabel('Time (seconds)')
plt.title('Time to Check All Primes from 1 to n')
plt.grid(True)
plt.legend()
plt.show()

```
![Image](https://ifh.cc/g/3G5zBc.png)

수는 대부분 소수가 아닌 합성수다. 이런 수를 그림에 점으로 표시했다.
그중 일부는 검사 비용이 적게 들지만 나머지는 여러 가지 인수를 검사해야만 한다.

작업을 프로세스 풀에 분산하면 얼마나 많은 작업이 각 작업자에 넘어갔는지를 정확히 알 수 없다. 모든 작업을 균등하게 배분해서 한 번에 넘겨 처리하거나, 작업을 수많은 단위로 구분해서 빈 코어에 전달할 수 있을 것이다.

이를 `chunksize` 매개변수를 사용해 제어한다. 작업 단위를 크게 만들면 통신 부가비용이 줄고, 작업 단위를 작게 만들면 자원 할당을 더 세밀하게 제어할 수 있다.

## 성능 최적화: chunksize 매개변수

소수 검색 프로그램의 작업 단위는 `check_prime`으로 검사할 수 n개다. `chunksize`을 10으로 설정하면 각 프로세스가 정수 10개로 이뤄진 목록을 한 번에 하나씩 처리한다.

### chunksize 설정 가이드

- **큰 chunksize**: 통신 오버헤드 감소, 하지만 부하 분산 효율성 저하
- **작은 chunksize**: 세밀한 부하 제어 가능, 하지만 통신 오버헤드 증가

적절한 `chunksize` 선택은 작업의 특성과 시스템 환경에 따라 달라진다.
