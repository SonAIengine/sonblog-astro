---
title: OpenSearch 설치 및 빌드를 위한 서버 자원 확인 절차
description: OpenSearch 설치 전 필요한 서버 자원 점검 명령어를 정리한다. CPU, 메모리, 디스크, 커널 파라미터, Docker
  환경, GPU 자원 등 안정적인 운영을 위해 확인해야 할 항목과 명령어를 다룬다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- 검색엔진
- 서버자원
- Linux
- Docker
- 인프라
- Search Engine
---


다음은 OpenSearch를 `192.168.2.171` 단일 서버에 설치 및 운영하기 위한 **자원 확인 명령어 목록**이다. 이 목록은 CPU, 메모리, 디스크, 커널 파라미터, Docker 환경, GPU 자원 등 OpenSearch 설치 및 ML 기능을 안정적으로 실행하기 위한 핵심 정보를 점검하는 데 필요한 모든 명령어를 포함하고 있다. 

명령어 실행 순서대로 점검하면 충분하다.

# OpenSearch 설치 및 빌드를 위한 서버 자원 확인 절차

## 1. 운영체제 및 커널 정보 확인

```bash
# OS 버전 확인
cat /etc/os-release

# 커널 버전 확인
uname -r
```

해당 정보를 통해 OpenSearch에서 요구하는 Linux 환경과 커널 버전을 충족하는지 확인할 수 있다.


## 2. CPU 자원 확인

```bash
# CPU 아키텍처 및 논리 코어 정보 확인
lscpu

# 사용 가능한 코어 수 확인
nproc
```

OpenSearch는 일반적으로 4코어 이상을 권장하며, ML 기능이나 대량 색인 작업을 수행할 경우 더 많은 코어가 필요하다.


## 3. 메모리 용량 확인

```bash
# 총 메모리 및 사용 가능한 메모리 확인
free -h

# kB 단위로 확인할 경우
grep MemTotal /proc/meminfo
```

ML 추론 기능을 사용하는 경우 16GB 이상의 메모리를 권장하며, 일반 검색 클러스터 구성에는 8GB 이상이 필요하다.


## 4. 디스크 용량 확인

```bash
# 루트 파티션 디스크 사용량 확인
df -h /

# 디스크 읽기 속도 측정 (옵션)
sudo hdparm -Tt /dev/sda
```

색인 및 벡터 저장 용량 확보를 위해 최소 10GB 이상의 여유 공간이 있어야 하며, 디스크 I/O 성능도 중요하다.


## 5. 가상 메모리 및 커널 파라미터 확인

```bash
# 스왑 영역 활성화 여부
swapon --summary

# 메모리 맵 최대값 확인 (최소 262144 이상이어야 함)
sysctl vm.max_map_count
```

`vm.max_map_count`는 OpenSearch가 Lucene 인덱스를 로드하는 데 필요한 설정으로, 미만일 경우 실행 오류가 발생할 수 있다.


## 6. Docker 설치 및 실행 상태 확인

```bash
# Docker 버전 확인
docker --version

# Docker 데몬 실행 여부 확인
sudo systemctl status docker
```

Docker Compose 기반 배포를 위해 Docker가 설치되어 있어야 하며, 실행 중이어야 한다.


## 7. 포트 바인딩 상태 확인

```bash
# 9200 (OpenSearch), 9600 (metrics), 5601 (Dashboards) 포트 확인
sudo ss -tuln | grep -E '9200|9600|5601'
```

해당 포트가 방화벽 또는 다른 서비스에 의해 막혀 있지 않아야 OpenSearch와 Dashboard가 정상적으로 외부에 노출된다.


## 8. Java 런타임 확인 (빌드 전용 시)

```bash
# Java 버전 확인
java -version
```

OpenSearch는 기본적으로 Java 11+를 포함하지만, 수동 빌드나 개발 환경에서는 Java 설치 여부를 확인해야 한다.


## 9. GPU 자원 확인 (선택 사항)

```bash
# NVIDIA GPU 정보 확인 (CUDA 기반)
nvidia-smi

# AMD ROCm 기반 GPU 확인
rocminfo

# GPU 장치 정보 확인
lshw -C display
```

ML 모델 추론 성능을 높이기 위해 GPU를 사용할 수 있다면, 해당 GPU의 종류 및 VRAM 용량을 확인해야 한다.


## 10. cgroup 및 Docker 자원 격리 가능 여부 확인

```bash
# 시스템에서 사용하는 cgroup 버전 확인
mount | grep cgroup

# cgroup2 사용 여부 확인
stat -fc %T /sys/fs/cgroup
```

Docker가 cgroup v2를 사용하고 있다면, 메모리 및 CPU 제한 기능이 더 정밀하게 작동한다.


## 11. 사용자 자원 제한 (ulimit) 확인

```bash
# 현재 유저의 리소스 제한 확인
ulimit -a

# 메모리 lock 제한 확인
ulimit -l
```

OpenSearch는 메모리 락(lock)이 필요하므로 `ulimit -l`이 `unlimited` 상태이거나 충분히 높은 값으로 설정되어 있어야 한다.

# 요약

아래는 OpenSearch 설치 및 ML 기능을 안정적으로 운영하기 위한 최소 요구 조건이다.

| 항목               | 권장 값                     |
| ---------------- | ------------------------ |
| CPU              | 4 코어 이상                  |
| 메모리              | 8GB 이상 (ML 기능 시 16GB 이상) |
| 디스크              | 10GB 이상 여유 공간            |
| vm.max_map_count | 262144 이상                |
| Docker           | 설치 및 실행 상태               |
| 포트               | 9200, 9600, 5601 개방 상태   |
| GPU (선택)         | CUDA 또는 ROCm 호환 GPU      |
