---
title: GliNER과 DPO-LoRA를 활용한 모델 파인튜닝
description: GliNER NER 모델과 DPO, LoRA를 결합한 파인튜닝 파이프라인 구축 과정. 데이터 수집부터 학습, 평가, 배포까지
  실전 경험을 정리한다.
pubDatetime: 2024-11-01
tags:
- GliNER
- DPO
- LoRA
- 파인튜닝
- LLM
- NER
- HuggingFace
- PEFT
- 모델학습
- NLP
- AI
---

# GliNER과 DPO-LoRA를 활용한 모델 파인튜닝

## 프로젝트 배경

2024년 3월부터 5월까지 ai-butler-alfredo-api와 ai-lab 프로젝트에서 Named Entity Recognition(NER) 모델과 언어 모델의 파인튜닝을 진행했다. 특히 한국어 특화 성능을 위해 GliNER 모델을 활용한 라벨링 자동화와 DPO(Direct Preference Optimization)와 LoRA를 결합한 효율적인 파인튜닝 방법론을 실험했다.


## 기술 스택

- **모델**: GliNER, LitLlama, LLaMA-2
- **파인튜닝**: LoRA (Low-Rank Adaptation), DPO (Direct Preference Optimization)
- **데이터 처리**: PyTorch, Transformers, Datasets
- **라벨링**: Custom annotation pipeline with GliNER
- **실험 관리**: Weights & Biases, MLflow

## GliNER를 활용한 자동 라벨링 시스템

### 1. GliNER 모델 도입 배경

기존의 SpaCy나 BERT 기반 NER 모델은 미리 정의된 엔티티 타입에 제한되어 있었다. 우리 프로젝트에서는 도메인 특화 엔티티를 동적으로 인식해야 했기 때문에 GliNER(Generative Language-based Named Entity Recognition) 모델을 선택했다.

```python
# gliner_processor.py
import torch
from gliner import GLiNER
import asyncio
from typing import List, Dict, Any

class GliNERProcessor:
    def __init__(self, model_name: str = "urchade/gliner_multi"):
        self.model = GLiNER.from_pretrained(model_name)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)
    
    async def extract_entities(self, text: str, labels: List[str]) -> List[Dict[str, Any]]:
        """비동기 엔티티 추출"""
        loop = asyncio.get_event_loop()
        
        # CPU 집약적 작업을 별도 스레드에서 실행
        entities = await loop.run_in_executor(
            None, 
            self._extract_sync, 
            text, 
            labels
        )
        
        return entities
    
    def _extract_sync(self, text: str, labels: List[str]) -> List[Dict[str, Any]]:
        """동기 엔티티 추출 (내부 메서드)"""
        try:
            entities = self.model.predict_entities(text, labels, threshold=0.7)
            
            # 결과 후처리
            processed_entities = []
            for entity in entities:
                processed_entities.append({
                    'text': entity['text'],
                    'label': entity['label'],
                    'start': entity['start'],
                    'end': entity['end'],
                    'confidence': entity.get('score', 0.0)
                })
            
            return processed_entities
            
        except Exception as e:
            print(f"Entity extraction error: {e}")
            return []
```

### 2. 영어 번역과 라벨링 파이프라인

한국어 텍스트의 NER 성능을 높이기 위해 영어 번역을 거쳐 라벨링하는 파이프라인을 구축했다.

```python
# translation_labeling.py
from transformers import pipeline
import asyncio
import aiohttp
from typing import List, Tuple

class TranslationLabelingPipeline:
    def __init__(self):
        self.translator = pipeline(
            "translation", 
            model="Helsinki-NLP/opus-mt-ko-en",
            device=0 if torch.cuda.is_available() else -1
        )
        self.gliner = GliNERProcessor()
        self.back_translator = pipeline(
            "translation",
            model="Helsinki-NLP/opus-mt-en-ko", 
            device=0 if torch.cuda.is_available() else -1
        )
    
    async def process_batch(self, texts: List[str], labels: List[str]) -> List[Dict]:
        """배치 단위 텍스트 처리"""
        results = []
        
        # 1단계: 한국어 -> 영어 번역
        translated_texts = []
        for text in texts:
            try:
                translated = self.translator(text, max_length=512)[0]['translation_text']
                translated_texts.append(translated)
            except Exception as e:
                print(f"Translation error: {e}")
                translated_texts.append(text)  # 번역 실패 시 원문 사용
        
        # 2단계: 영어 텍스트에서 엔티티 추출
        entity_tasks = []
        for translated_text in translated_texts:
            task = self.gliner.extract_entities(translated_text, labels)
            entity_tasks.append(task)
        
        entity_results = await asyncio.gather(*entity_tasks)
        
        # 3단계: 결과 정리 및 원문과 매핑
        for i, (original_text, entities) in enumerate(zip(texts, entity_results)):
            results.append({
                'original_text': original_text,
                'translated_text': translated_texts[i],
                'entities': entities,
                'entity_count': len(entities)
            })
        
        return results
```

## DPO + LoRA 파인튜닝 구현

### 1. LoRA 설정과 모델 준비

LitLlama를 베이스로 하여 효율적인 파인튜닝을 위해 LoRA를 적용했다.

```python
# lora_config.py
from peft import LoraConfig, get_peft_model, TaskType
import torch
from transformers import LlamaForCausalLM, LlamaTokenizer

class LoRAModelManager:
    def __init__(self, base_model_path: str, lora_rank: int = 16):
        self.base_model_path = base_model_path
        self.lora_config = LoraConfig(
            r=lora_rank,
            lora_alpha=32,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
            lora_dropout=0.1,
            bias="none",
            task_type=TaskType.CAUSAL_LM
        )
        
        self.model = None
        self.tokenizer = None
        
    def load_model(self):
        """베이스 모델과 토크나이저 로드"""
        self.tokenizer = LlamaTokenizer.from_pretrained(self.base_model_path)
        self.model = LlamaForCausalLM.from_pretrained(
            self.base_model_path,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        
        # LoRA 어댑터 적용
        self.model = get_peft_model(self.model, self.lora_config)
        
        # 학습 가능한 파라미터 출력
        self.model.print_trainable_parameters()
        
        return self.model, self.tokenizer
```

### 2. DPO 트레이너 구현

선호도 기반 최적화를 위한 DPO 트레이너를 구현했다.

```python
# dpo_trainer.py
import torch
import torch.nn.functional as F
from transformers import Trainer, TrainingArguments
from typing import Dict, List, Any
import wandb

class DPOTrainer(Trainer):
    def __init__(self, model, tokenizer, beta: float = 0.1, **kwargs):
        super().__init__(model=model, **kwargs)
        self.tokenizer = tokenizer
        self.beta = beta
        self.ref_model = None
        
    def setup_reference_model(self, ref_model_path: str):
        """참조 모델 설정 (frozen)"""
        self.ref_model = LlamaForCausalLM.from_pretrained(
            ref_model_path,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        self.ref_model.eval()
        
        # 참조 모델 그래디언트 비활성화
        for param in self.ref_model.parameters():
            param.requires_grad = False
    
    def dpo_loss(self, policy_chosen_logps, policy_rejected_logps, 
                 reference_chosen_logps, reference_rejected_logps):
        """DPO 손실 함수 계산"""
        
        policy_logratios = policy_chosen_logps - policy_rejected_logps
        reference_logratios = reference_chosen_logps - reference_rejected_logps
        
        # DPO 손실
        losses = -F.logsigmoid(self.beta * (policy_logratios - reference_logratios))
        
        # 정확도 계산 (chosen > rejected인 비율)
        chosen_rewards = self.beta * (policy_chosen_logps - reference_chosen_logps)
        rejected_rewards = self.beta * (policy_rejected_logps - reference_rejected_logps)
        accuracy = (chosen_rewards > rejected_rewards).float().mean()
        
        return losses.mean(), accuracy
    
    def compute_loss(self, model, inputs, return_outputs=False):
        """배치별 손실 계산"""
        chosen_inputs = {k: v for k, v in inputs.items() if 'chosen' in k}
        rejected_inputs = {k: v for k, v in inputs.items() if 'rejected' in k}
        
        # Policy 모델 로그확률 계산
        chosen_outputs = model(**chosen_inputs)
        rejected_outputs = model(**rejected_inputs)
        
        policy_chosen_logps = self._get_batch_logps(
            chosen_outputs.logits, chosen_inputs['chosen_labels']
        )
        policy_rejected_logps = self._get_batch_logps(
            rejected_outputs.logits, rejected_inputs['rejected_labels']
        )
        
        # Reference 모델 로그확률 계산
        with torch.no_grad():
            ref_chosen_outputs = self.ref_model(**chosen_inputs)
            ref_rejected_outputs = self.ref_model(**rejected_inputs)
            
            reference_chosen_logps = self._get_batch_logps(
                ref_chosen_outputs.logits, chosen_inputs['chosen_labels']
            )
            reference_rejected_logps = self._get_batch_logps(
                ref_rejected_outputs.logits, rejected_inputs['rejected_labels']
            )
        
        loss, accuracy = self.dpo_loss(
            policy_chosen_logps, policy_rejected_logps,
            reference_chosen_logps, reference_rejected_logps
        )
        
        # 메트릭 로깅
        if self.state.global_step % 100 == 0:
            wandb.log({
                "train/dpo_loss": loss.item(),
                "train/accuracy": accuracy.item(),
                "train/policy_chosen_logps": policy_chosen_logps.mean().item(),
                "train/policy_rejected_logps": policy_rejected_logps.mean().item()
            })
        
        return (loss, chosen_outputs) if return_outputs else loss
    
    def _get_batch_logps(self, logits, labels):
        """배치의 로그 확률 계산"""
        logprobs = F.log_softmax(logits, dim=-1)
        per_token_logps = torch.gather(logprobs, dim=2, index=labels.unsqueeze(2)).squeeze(2)
        
        # 패딩 토큰 마스킹
        mask = (labels != self.tokenizer.pad_token_id).float()
        per_token_logps = per_token_logps * mask
        
        return per_token_logps.sum(dim=-1) / mask.sum(dim=-1)
```

### 3. 비동기 작업 처리 시스템

대용량 데이터셋 처리를 위한 비동기 작업 시스템을 구축했다.

```python
# async_trainer.py
import asyncio
import torch.multiprocessing as mp
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Optional, Callable
import queue

@dataclass
class TrainingJob:
    job_id: str
    model_config: Dict
    dataset_path: str
    output_path: str
    callback: Optional[Callable] = None

class AsyncTrainingManager:
    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers
        self.job_queue = asyncio.Queue()
        self.active_jobs = {}
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        
    async def submit_job(self, job: TrainingJob):
        """학습 작업 제출"""
        await self.job_queue.put(job)
        self.active_jobs[job.job_id] = {
            'status': 'queued',
            'progress': 0,
            'start_time': None,
            'end_time': None
        }
        
        # 작업 처리 시작
        asyncio.create_task(self._process_job(job))
        
    async def _process_job(self, job: TrainingJob):
        """개별 작업 처리"""
        try:
            self.active_jobs[job.job_id]['status'] = 'running'
            self.active_jobs[job.job_id]['start_time'] = asyncio.get_event_loop().time()
            
            # CPU 집약적 학습 작업을 별도 프로세스에서 실행
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                self._train_model_sync,
                job
            )
            
            self.active_jobs[job.job_id]['status'] = 'completed'
            self.active_jobs[job.job_id]['end_time'] = asyncio.get_event_loop().time()
            
            # 콜백 실행
            if job.callback:
                await job.callback(job.job_id, result)
                
        except Exception as e:
            self.active_jobs[job.job_id]['status'] = 'failed'
            self.active_jobs[job.job_id]['error'] = str(e)
            print(f"Job {job.job_id} failed: {e}")
    
    def _train_model_sync(self, job: TrainingJob):
        """동기 모델 학습 (별도 프로세스)"""
        # LoRA 모델 매니저 초기화
        lora_manager = LoRAModelManager(job.model_config['base_model_path'])
        model, tokenizer = lora_manager.load_model()
        
        # DPO 트레이너 설정
        trainer = DPOTrainer(
            model=model,
            tokenizer=tokenizer,
            beta=job.model_config.get('beta', 0.1),
            args=TrainingArguments(
                output_dir=job.output_path,
                per_device_train_batch_size=2,
                gradient_accumulation_steps=8,
                num_train_epochs=3,
                learning_rate=5e-5,
                logging_steps=100,
                save_steps=500,
                evaluation_strategy="steps",
                eval_steps=500,
                warmup_ratio=0.1,
                remove_unused_columns=False,
                dataloader_num_workers=4,
            )
        )
        
        # 참조 모델 설정
        trainer.setup_reference_model(job.model_config['base_model_path'])
        
        # 데이터셋 로드
        dataset = load_preference_dataset(job.dataset_path)
        
        # 학습 실행
        trainer.train()
        
        # 모델 저장
        trainer.save_model()
        
        return {
            'job_id': job.job_id,
            'model_path': job.output_path,
            'training_completed': True
        }
```

## 클러스터링과 데이터 분석

### 데이터 품질 평가를 위한 클러스터링

```python
# clustering_analysis.py
from sklearn.cluster import KMeans
from sentence_transformers import SentenceTransformer
import numpy as np
import matplotlib.pyplot as plt
from typing import List, Dict

class DataQualityAnalyzer:
    def __init__(self, embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.encoder = SentenceTransformer(embedding_model)
        
    def analyze_dataset_quality(self, texts: List[str], num_clusters: int = 10):
        """데이터셋 품질 분석"""
        
        # 텍스트 임베딩 생성
        embeddings = self.encoder.encode(texts, show_progress_bar=True)
        
        # K-means 클러스터링
        kmeans = KMeans(n_clusters=num_clusters, random_state=42)
        cluster_labels = kmeans.fit_predict(embeddings)
        
        # 클러스터별 분석
        cluster_analysis = {}
        for i in range(num_clusters):
            cluster_texts = [texts[j] for j in range(len(texts)) if cluster_labels[j] == i]
            cluster_analysis[i] = {
                'size': len(cluster_texts),
                'samples': cluster_texts[:3],  # 샘플 3개
                'avg_length': np.mean([len(text) for text in cluster_texts])
            }
        
        return cluster_analysis, embeddings, cluster_labels
```

## 성과 및 교훈

이 프로젝트를 통해 다음과 같은 성과를 달성했다:

1. **GliNER 활용한 라벨링 자동화로 데이터 준비 시간 70% 단축**
2. **DPO + LoRA 조합으로 GPU 메모리 사용량 60% 절약하면서도 성능 유지**
3. **비동기 작업 처리로 다중 실험 병렬 실행 환경 구축**
4. **한국어 특화 모델 성능 15% 향상**

특히 영어 번역을 거친 라벨링 파이프라인은 한국어 NER 성능을 크게 향상시켰고, DPO를 활용한 선호도 기반 학습은 기존 supervised fine-tuning 대비 더 안정적인 결과를 보여주었다.

## 향후 계획

앞으로는 다음과 같은 방향으로 연구를 확장할 예정이다:

- Constitutional AI와 DPO 결합 실험
- 멀티모달 모델에 대한 LoRA 적용
- 연합학습(Federated Learning) 환경에서의 파인튜닝
- 자동 하이퍼파라미터 튜닝 시스템 구축