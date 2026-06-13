---
title: 이미지 검색 기능 구현기 - 시맨틱 검색과 AI 분류의 만남
description: 2024년 7월부터 9월까지 진행한 이미지 기반 상품 검색 시스템 개발기. CLIP 모델로 이미지를 벡터화하고 배경 제거,
  AI 분류를 결합한 시맨틱 이미지 검색 구현 과정이다.
pubDatetime: 2024-09-15
tags:
- 이미지검색
- 벡터검색
- CLIP
- 검색엔진
- 시맨틱검색
- 배경제거
- 딥러닝
- OpenSearch
- 임베딩
- 커머스
- Search Engine
series: AI 시맨틱 검색
seriesOrder: 2
---

# 이미지 검색 기능 구현기 - 시맨틱 검색과 AI 분류의 만남

> 2024년 7월부터 9월까지 진행한 이미지 기반 상품 검색 시스템 개발기를 정리한다. 단순한 이미지 매칭을 넘어 AI 분류와 배경 제거 기술을 접목한 시맨틱 이미지 검색 구현 과정이다.

## 프로젝트 개요

기존 텍스트 기반 검색의 한계를 극복하고자 이미지를 업로드하면 유사한 상품을 찾아주는 시스템을 개발했다. 사용자가 SNS에서 본 옷이나 제품 이미지를 업로드하면, 우리 쇼핑몰의 유사한 상품을 추천하는 것이 목표였다.

**핵심 기능:**
- 이미지 업로드를 통한 상품 검색
- AI 기반 카테고리 자동 분류
- 배경 제거를 통한 정확도 향상
- 실시간 이미지 처리 파이프라인

## 기술 아키텍처

### 1. 이미지 처리 파이프라인

```python
# imageClassification.py 핵심 구조
class ImageSearchPipeline:
    def __init__(self):
        self.background_remover = RemovalModel()
        self.feature_extractor = ImageFeatureExtractor()
        self.category_classifier = CategoryClassifier()
        self.vector_search = VectorSearch()
    
    def search_similar_products(self, image_path):
        # 1. 배경 제거
        clean_image = self.remove_background(image_path)
        
        # 2. 특징 추출
        features = self.extract_features(clean_image)
        
        # 3. 카테고리 예측
        category = self.classify_category(clean_image)
        
        # 4. 유사 상품 검색
        results = self.vector_search.find_similar(features, category)
        
        return results
```

### 2. 배경 제거 시스템

이미지 검색에서 가장 큰 도전 과제는 배경 노이즈였다. 사용자가 업로드하는 이미지는 다양한 배경을 가지고 있어, 상품 자체의 특징을 추출하기 어려웠다.

**U-Net 기반 배경 제거 모델 도입:**

```python
def remove_background(self, image_path):
    """
    배경 제거 로직
    - U-Net 세그멘테이션 모델 사용
    - 전처리: 리사이즈, 정규화
    - 후처리: 마스크 적용, 경계 부드럽게 처리
    """
    image = cv2.imread(image_path)
    image_resized = cv2.resize(image, (512, 512))
    
    # 모델 예측
    mask = self.segmentation_model.predict(image_resized)
    
    # 마스크 적용
    result = image * mask[..., np.newaxis]
    
    # 배경을 투명하게 처리
    result = self.add_transparency(result, mask)
    
    return result
```

**성능 최적화 과정:**
- 초기 모델: 2.3초/이미지 → 최적화 후: 0.8초/이미지
- 배치 처리 도입으로 동시 처리량 5배 증가
- GPU 메모리 사용량 40% 감소

### 3. 배치 처리 시스템

대용량 이미지 처리를 위한 배치 시스템을 구축했다. 기존 상품 이미지들을 미리 벡터화하여 검색 속도를 향상시켰다.

```python
# betchUtil.py - 배치 처리 유틸리티
class BatchProcessor:
    def __init__(self, batch_size=32):
        self.batch_size = batch_size
        self.processed_count = 0
    
    def process_product_images(self, image_list):
        """
        상품 이미지 배치 처리
        - 배경 제거
        - 특징 벡터 추출
        - 카테고리 분류
        - 벡터 DB 저장
        """
        batches = self.create_batches(image_list)
        
        for batch in batches:
            # 병렬 처리
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [
                    executor.submit(self.process_single_image, img)
                    for img in batch
                ]
                
                results = [f.result() for f in futures]
                
            # 결과 저장
            self.save_to_vector_db(results)
            self.processed_count += len(batch)
            
            print(f"Processed: {self.processed_count}/{len(image_list)}")
```

### 4. 카테고리 분류 모델

이미지만으로는 정확한 검색이 어려워, AI 기반 카테고리 분류를 도입했다. ResNet-50을 베이스로 한 분류 모델을 파인튜닝하여 사용했다.

**분류 카테고리:**
- 의류: 상의, 하의, 아우터, 신발
- 전자제품: 스마트폰, 노트북, 이어폰
- 가구: 침대, 의자, 테이블
- 기타: 잡화, 뷰티, 스포츠

```python
# categoryPredict 모델
class CategoryClassifier:
    def __init__(self, model_path):
        self.model = self.load_model(model_path)
        self.categories = self.load_categories()
    
    def predict(self, image):
        """
        이미지 카테고리 예측
        - 전처리: 224x224 리사이즈, ImageNet 정규화
        - 예측: softmax 출력
        - 후처리: 신뢰도 필터링
        """
        preprocessed = self.preprocess(image)
        
        with torch.no_grad():
            output = self.model(preprocessed)
            probabilities = F.softmax(output, dim=1)
            
        predicted_class = torch.argmax(probabilities, dim=1)
        confidence = torch.max(probabilities, dim=1)[0]
        
        # 신뢰도가 낮으면 '기타'로 분류
        if confidence < 0.7:
            return "기타", confidence.item()
            
        return self.categories[predicted_class], confidence.item()
```

## 핵심 도전과제와 해결책

### 1. 검색 정확도 문제

**문제:** 초기에는 배경이 복잡한 이미지에서 검색 정확도가 떨어졌다.

**해결:** 
- 배경 제거 로직 강화
- 다양한 각도/조명 조건으로 훈련 데이터 증강
- 앙상블 모델링으로 강건성 향상

### 2. 실시간 처리 성능

**문제:** 이미지 처리 시간이 3초 이상 소요되어 사용자 경험이 나빴다.

**해결:**
```python
# 성능 최적화 방안
1. 모델 양자화 (FP32 → FP16)
2. TensorRT 추론 엔진 도입
3. 이미지 전처리 파이프라인 최적화
4. Redis 캐싱으로 중복 요청 처리
```

### 3. GPU 메모리 관리

**문제:** 배치 처리 중 GPU 메모리 부족으로 프로세스가 종료되는 문제

**해결:**
```python
def manage_gpu_memory(self):
    """
    GPU 메모리 관리
    - 배치 크기 동적 조절
    - 가비지 컬렉션 최적화
    - 메모리 사용량 모니터링
    """
    if torch.cuda.memory_allocated() > 0.8 * torch.cuda.max_memory_allocated():
        torch.cuda.empty_cache()
        self.reduce_batch_size()
```

## 성능 지표 및 결과

**검색 정확도 (Top-5 기준):**
- 의류: 87% → 92% (배경제거 후)
- 전자제품: 91% → 94%
- 가구: 73% → 85%
- 전체 평균: 83% → 89%

**처리 성능:**
- 단일 이미지 검색: 평균 1.2초
- 배치 처리: 150 images/minute
- 동시 사용자: 50명 지원

**사용자 만족도:**
- 검색 결과 만족도: 78% → 89%
- 검색 속도 만족도: 65% → 85%

## 트러블슈팅 사례

### 1. 모델 로딩 오류 해결

모델 파일 경로 문제로 서버 시작 시 모델 로딩이 실패하는 문제가 발생했다.

```python
# 해결 방법: 절대 경로와 예외 처리 강화
def load_model_safely(self, model_path):
    try:
        # 절대 경로로 변환
        abs_path = os.path.abspath(model_path)
        
        if not os.path.exists(abs_path):
            # fallback 모델 경로
            abs_path = os.path.join(self.model_dir, "backup_model.pth")
            
        model = torch.load(abs_path, map_location=self.device)
        logger.info(f"Model loaded successfully: {abs_path}")
        return model
        
    except Exception as e:
        logger.error(f"Model loading failed: {e}")
        return self.load_default_model()
```

### 2. 배치 처리 중단 문제

대용량 데이터 처리 중 메모리 부족으로 프로세스가 중단되는 문제를 체크포인트 시스템으로 해결했다.

```python
def resume_from_checkpoint(self):
    """
    체크포인트에서 배치 처리 재시작
    """
    if os.path.exists(self.checkpoint_file):
        with open(self.checkpoint_file, 'r') as f:
            checkpoint = json.load(f)
            self.processed_count = checkpoint['processed_count']
            self.failed_images = checkpoint['failed_images']
        
        print(f"Resuming from checkpoint: {self.processed_count} processed")
```

## 향후 개선 계획

1. **멀티모달 검색**: 텍스트 + 이미지 결합 검색
2. **실시간 개인화**: 사용자 검색 히스토리 기반 추천
3. **3D 객체 인식**: AR/VR 연계 기능
4. **지속적 학습**: 사용자 피드백 기반 모델 업데이트

이미지 검색 시스템을 구축하면서 AI 모델의 실제 서비스 적용 시 고려해야 할 다양한 측면을 경험할 수 있었다. 단순한 기술 구현을 넘어 사용자 경험과 시스템 안정성을 모두 고려한 종합적인 접근이 필요함을 깨달았다.