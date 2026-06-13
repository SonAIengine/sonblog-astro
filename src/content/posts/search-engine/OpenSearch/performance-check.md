---
title: OpenSearch 성능 벤치마크와 TPS별 서버 구성 가이드
description: OpenSearch의 워크로드별 성능 벤치마크와 TPS 기준 서버 구성 사례를 정리한다. Trail of Bits 테스트 결과,
  CPU/RAM 사양별 권장 구성, GPU 노드 활용 시나리오를 다룬다.
pubDatetime: 2025-07-17
tags:
- OpenSearch
- 검색엔진
- 벤치마크
- 성능최적화
- GPU
- 인프라
- Search Engine
---


## 워크로드 기준(TPS)에 따른 구성 사례

|예상 TPS|사용 사례|CPU|RAM|구성 형태|벤치마크 참고|
|---|---|---|---|---|---|
|~10 TPS|내부 PoC, 팀 문서 검색|4 vCPU|8 GB|단일 노드|일반적으로 검색 응답 속도 약 30–100ms이다|
|10–50 TPS|쇼핑몰, 사내 검색 등|8 vCPU|16 GB|단일 클러스터, 벡터 가능|OpenSearch 3.0에서 벡터 처리 성능 2.5배 향상됨 ([OpenSearch](https://opensearch.org/blog/opensearch-project-update-performance-progress-in-opensearch-3-0/?utm_source=chatgpt.com "OpenSearch Project update: Performance progress in OpenSearch 3.0"))|
|50–300 TPS|실시간 로그 분석, 실시간 상품 검색|16 vCPU|32 GB|다중 노드 구성 권장|2.17에서 저지연 응답 위해 동시 세그먼트 검색 도입|
|300+ TPS|실시간 광고 등 초고속 검색|32+ vCPU|64 GB 이상|샤드 분산, ML/GPU 노드 분리 필수|CCR 테스트에서 leader CPU 사용량만 12% 증가|

## GPU: 단순 임베딩 기반 K‑NN 검색용

| TPS 범위     | GPU 예시 사양                               | RTX 4090 대비 성능 | 주요 용도                | 가격 (온프레미스, 2025년 기준)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------- | -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~10 TPS    | NVIDIA T4 / L4 (16GB)                   | 20–30% 수준      | 소규모 문서 검색, 팀 내 검색    | T4: 약 $700(중고) ([아마존](https://www.amazon.com/PNY-Datacenter-Express-Passive-Cooling/dp/B07QF9MJFR?utm_source=chatgpt.com "PNY NVIDIA Tesla T4 Datacenter Card 16GB GDDR6 PCI Express ...")), L4: 약 $2,000 추정 \|                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10–50 TPS  | NVIDIA A10 (24GB) / RTX 6000 Ada (48GB) | 90–110% 수준     | 중소형 쇼핑몰 및 FAQ 검색     | A10: 약 $3,000 (추정), RTX 6000 Ada: $5,000–6,000 \|                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 50–300 TPS | NVIDIA A100 40GB / 2×L40s               | 200–250% 이상    | 대용량 상품 검색, 병렬 ANN 처리 | A100 40GB: $10,000–12,000 ([simplepod.ai](https://simplepod.ai/blog/nvidia-a100-price/?utm_source=chatgpt.com "Understand the Nvidia A100 Price - SimplePod.AI Blog")), L40s: $7,500–9,600 \|                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 300+ TPS   | 2×A100 80GB / 4×L40s / H100             | 300–400% 이상    | 초고속 검색, 글로벌 서비스      | A100 80GB: $13,000–15,000 ([Massed Compute](https://massedcompute.com/faq-answers/?question=What+are+the+estimated+costs+for+a+single+NVIDIA+A100+SXM4+GPU+in+an+on-premises+deployment%3F&utm_source=chatgpt.com "What are the estimated costs for a single NVIDIA A100 SXM4 GPU ...")); H100: $25,000 ([Cyfuture Cloud](https://cyfuture.cloud/kb/gpu/how-much-does-the-nvidia-h100-gpu-cost-in-2025?utm_source=chatgpt.com "How Much Does the NVIDIA H100 GPU Cost in 2025?"), [docs.jarvislabs.ai](https://docs.jarvislabs.ai/blog/h100-price?utm_source=chatgpt.com "NVIDIA H100 Price Guide 2025: Detailed Costs, Comparisons ...")) |


## GPU: Reranker 포함 (LLM 후처리) 검색용

|TPS 범위|GPU 예시 사양|RTX 4090 대비 성능|주요 용도|가격 (온프레미스, 2025년 기준)|
|---|---|---|---|---|
|~10 TPS|RTX 4090 (24GB) / NVIDIA L40|기준 성능 (100%)|Q&A 기반 검색, 단문 rerank|RTX 4090: $1,600 (MSRP) ([Reddit](https://www.reddit.com/r/buildapc/comments/1jg0paf/when_did_1k_gpu_becomes_pocket_change/?utm_source=chatgpt.com "When did $1k+ GPU becomes pocket change? : r/buildapc - Reddit"), [PC Gamer](https://www.pcgamer.com/best-graphics-card-deals-today/?utm_source=chatgpt.com "Best graphics card deals for every budget"), [Cyfuture Cloud](https://cyfuture.cloud/kb/gpu/how-much-does-the-nvidia-h100-gpu-cost-in-2025?utm_source=chatgpt.com "How Much Does the NVIDIA H100 GPU Cost in 2025?")); L40: $3,500–4,500 \||
|10–50 TPS|A100 40GB / RTX 6000 Ada ×2|200–250% 수준|상품 검색 + LLM reranker 조합|A100: $10,000–12,000 ([Business Insider](https://www.businessinsider.com/elon-musk-xai-data-center-colossus-power-memphis-2025-4?utm_source=chatgpt.com "Elon Musk's xAI is spending at least $400 million building its supercomputer in Memphis. It's short on electricity."), [simplepod.ai](https://simplepod.ai/blog/nvidia-a100-price/?utm_source=chatgpt.com "Understand the Nvidia A100 Price - SimplePod.AI Blog")); RTX 6000 Ada×2: $10,000–12,000 \||
|50–300 TPS|2×A100 80GB / 4×L40s / H100|300–400% 이상|고난도 문서 분류, 멀티턴 rerank|A100 80GB: $13,000–15,000 ([PC Gamer](https://www.pcgamer.com/hardware/for-the-first-time-this-generation-u-s-retailers-are-listing-nvidia-rtx-50-series-graphics-cards-below-msrp/?utm_source=chatgpt.com "For the first time this generation US retailers are listing Nvidia RTX 50 series graphics cards below MSRP")); H100: $25,000 ([Cyfuture Cloud](https://cyfuture.cloud/kb/gpu/how-much-does-the-nvidia-h100-gpu-cost-in-2025?utm_source=chatgpt.com "How Much Does the NVIDIA H100 GPU Cost in 2025?"), [docs.jarvislabs.ai](https://docs.jarvislabs.ai/blog/h100-price?utm_source=chatgpt.com "NVIDIA H100 Price Guide 2025: Detailed Costs, Comparisons ..."))|
|300+ TPS|H100 4장 이상 또는 GPU 팜 구성|400% 이상|대규모 광고, 실시간 정밀 rerank 등|H100×4: $100,000+ (estimated from $25k each) ([Massed Compute](https://massedcompute.com/faq-answers/?question=What+are+the+estimated+costs+for+a+single+NVIDIA+A100+SXM4+GPU+in+an+on-premises+deployment%3F&utm_source=chatgpt.com "What are the estimated costs for a single NVIDIA A100 SXM4 GPU ..."))|

## 색인 규모 기준 사례

|색인 규모|문서 수|구성 추천|
|---|---|---|
|< 1 M|수십만 문서|4 vCPU, 8 GB|
|1–10 M|뉴스·상품|8 vCPU, 16 GB|
|10–100 M|로그, 대규모 상품|16 vCPU, 64 GB, 복수 노드|
|> 100 M|SIEM, 빅데이터|32+ vCPU, 128 GB+, 완전 분산|

- 벤치마크에 따르면 OpenSearch 2.17은 1.3 대비 최대 6배 향상된 성능을 보였다 ([AWS Documentation](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-instances.html?utm_source=chatgpt.com "Choosing instance types and testing - Amazon OpenSearch Service"), [OpenSearch](https://opensearch.org/blog/opensearch-project-update-performance-progress-in-opensearch-3-0/?utm_source=chatgpt.com "OpenSearch Project update: Performance progress in OpenSearch 3.0"), [Instaclustr](https://www.instaclustr.com/blog/opensearch-performance-benchmarking/?utm_source=chatgpt.com "OpenSearch® performance benchmarking for CCR - Instaclustr"), [Elastic](https://www.elastic.co/search-labs/blog/elasticsearch-opensearch-vector-search-performance-comparison?utm_source=chatgpt.com "Elasticsearch vs. OpenSearch: Vector Search Performance ..."), [Cloudchipr](https://cloudchipr.com/blog/aws-opensearch?utm_source=chatgpt.com "AWS OpenSearch Deep Dive: Architecture, Pricing, and Best Practices"), [Redis](https://redis.io/blog/benchmarking-results-for-vector-databases/?utm_source=chatgpt.com "Benchmarking results for vector databases | Redis"), [OpenSearch](https://opensearch.org/blog/opensearch-performance-2-17/?utm_source=chatgpt.com "A look at performance progress through version 2.17 - OpenSearch")).
    
- Vector Engine의 on‑disk 모드 사용 시 메모리를 97% 절감하면서도 P90 지연 100–200ms 수준 유지됨 ([Amazon Web Services, Inc.](https://aws.amazon.com/blogs/big-data/opensearch-vector-engine-is-now-disk-optimized-for-low-cost-accurate-vector-search/?utm_source=chatgpt.com "OpenSearch Vector Engine is now disk-optimized for low cost ... - AWS")).
    


## 벡터 검색 및 엔진 비교 성능

- OpenSearch 3.0에서 벡터 검색 성능이 2.5배 향상됨 ([OpenSearch](https://opensearch.org/blog/opensearch-project-update-performance-progress-in-opensearch-3-0/?utm_source=chatgpt.com "OpenSearch Project update: Performance progress in OpenSearch 3.0")).
    
- Elastic 社 BBQ vs OpenSearch FAISS 비교 결과, Elastic 제품이 최대 5배 빠름 ([Elastic](https://www.elastic.co/search-labs/blog/elasticsearch-bbq-vs-opensearch-faiss?utm_source=chatgpt.com "Elasticsearch BBQ vs. OpenSearch FAISS: Vector search ...")).
    
- 그러나 독립 벤치마크 결과 OpenSearch 2.17.1이 Elastic 8.15.4 대비 벡터 검색에서 P90 기준 11% 빠름 ([The Trail of Bits Blog](https://blog.trailofbits.com/2025/03/06/benchmarking-opensearch-and-elasticsearch/?utm_source=chatgpt.com "Benchmarking OpenSearch and Elasticsearch - The Trail of Bits Blog")).

## 실제 사례 추가

### 사례 1: Elastic vs OpenSearch 비교 테스트

Trail of Bits 테스트에서 OpenSearch 2.17.1은 Big5 워크로드에서 Elastic 보다 1.6배 빠르고, 벡터 워크로드에서는 11% 더 빠른 성능을 보였다 ([The Trail of Bits Blog](https://blog.trailofbits.com/2025/03/06/benchmarking-opensearch-and-elasticsearch/?utm_source=chatgpt.com "Benchmarking OpenSearch and Elasticsearch - The Trail of Bits Blog")).

### 사례 2: CCR(교차 클러스터 복제) 영향

AWS 벤치마크에 따르면, leader 노드의 CPU 사용률이 +12.4%, 90th percentile 인덱싱 지연이 +3.9% 증가했지만 검색 성능은 거의 영향 없었다 ([Instaclustr](https://www.instaclustr.com/blog/opensearch-performance-benchmarking/?utm_source=chatgpt.com "OpenSearch® performance benchmarking for CCR - Instaclustr")).

### 사례 3: Disk‑optimized 벡터 엔진 사례

Amazon OpenSearch Service에서 disk 모드 사용 시 메모리 97% 절감, P90 응답 100–200ms로 유지되며 비용 효율적임 ([Amazon Web Services, Inc.](https://aws.amazon.com/blogs/big-data/opensearch-vector-engine-is-now-disk-optimized-for-low-cost-accurate-vector-search/?utm_source=chatgpt.com "OpenSearch Vector Engine is now disk-optimized for low cost ... - AWS")).


## 요약: 기준 및 구성 예시 정리

1. **TPS(트래픽)**
    
    - ~10 TPS: 4 vCPU/8GB
        
    - 50–300 TPS: 16 vCPU/32GB, 다중 노드
        
    - 300+ TPS: 32+ vCPU/64GB 이상, 클러스터 분리
        
2. **색인 규모**
    
    - < 1M: 4 vCPU/8GB
        
    - 1–10M: 8 vCPU/16GB
        
    - 10–100M: 16 vCPU/64GB
        
    - >  100M: 32+ vCPU/128GB+, 분산 노드
        
3. **검색 유형**
    
    - BM25: 경량 구성 가능
        
    - 벡터/하이브리드: CPU 중심 2.5배 속도 향상
        
    - RAG/AI 재랭킹: GPU 포함 ML 서버 별도 구성 추천
        
4. **엔진·모드 선택**
    
    - on‑disk 모드로 메모리 최적화 (P90 200ms)
        
    - concurrent segment search, disk‑optimized vector engine 사용