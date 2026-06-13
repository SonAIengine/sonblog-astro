---
title: Code Assistant 개발기 - AI 기반 개발 도우미 시스템 구축
description: OpenAI API와 로컬 모델을 결합하여 개발자의 생산성을 높이는 AI 코드 어시스턴트를 구축한 경험담. RAG 기반 코드베이스
  검색, VSCode 플러그인 연동까지.
pubDatetime: 2024-10-01
tags:
- Code Assistant
- RAG
- LLM
- VSCode
- OpenAI
- Python
- FastAPI
- 개발도구
- AI개발
- 코드검색
- AI
---

# Code Assistant 개발기 - AI 기반 개발 도우미 시스템 구축

> 2024년 8월부터 10월까지 진행한 AI 기반 코드 어시스턴트 개발 과정을 정리한다. OpenAI API와 로컬 모델을 결합하여 개발자의 생산성을 높이는 시스템을 구축한 경험담이다.

## 프로젝트 배경

개발팀 내부에서 반복적인 코드 작성과 리뷰 과정에 많은 시간을 소모하고 있었다. 특히 다음과 같은 작업들이 비효율적이었다:

- **API 문서 생성**: 수동으로 스웨거 문서 작성
- **코드 리뷰**: 단순한 스타일 가이드 체크
- **테스트 케이스 생성**: 보일러플레이트 코드 반복
- **버그 분석**: 에러 로그 패턴 분석

이런 반복 작업을 자동화하고 개발자가 핵심 로직에 집중할 수 있도록 AI 어시스턴트를 개발하기로 했다.

## 시스템 아키텍처

### 1. 하이브리드 AI 모델 구조

비용과 성능을 모두 고려하여 OpenAI GPT-4와 로컬 모델을 적절히 조합한 하이브리드 구조를 채택했다.

```python
class CodeAssistant:
    def __init__(self):
        self.openai_client = OpenAIClient()
        self.local_models = {
            'category': CategoryClassifier(),
            'complexity': ComplexityAnalyzer(),
            'style': CodeStyleChecker()
        }
    
    def analyze_code(self, code, task_type):
        """
        코드 분석 메인 로직
        - 단순한 분류/체크 → 로컬 모델
        - 복잡한 생성/추론 → OpenAI API
        """
        # 1. 작업 유형 분류 (로컬)
        category = self.local_models['category'].predict(code)
        
        # 2. 복잡도 분석 (로컬)  
        complexity = self.local_models['complexity'].analyze(code)
        
        # 3. 적절한 모델 선택
        if complexity < 0.7 and category in ['style_check', 'simple_refactor']:
            return self.process_locally(code, task_type)
        else:
            return self.process_with_openai(code, task_type)
```

### 2. OpenAI 연동 최적화

OpenAI API 사용 비용을 줄이면서도 품질을 유지하기 위한 다양한 최적화 기법을 적용했다.

```python
# openai 설정 최적화
class OpenAIOptimizer:
    def __init__(self):
        self.cache = RedisCache()
        self.token_limiter = TokenLimiter()
        
    def optimize_prompt(self, code, task):
        """
        프롬프트 최적화
        - 불필요한 공백/주석 제거
        - 컨텍스트 길이 최적화
        - 템플릿 기반 프롬프트 구성
        """
        # 코드 전처리
        cleaned_code = self.clean_code(code)
        
        # 토큰 수 체크
        if self.count_tokens(cleaned_code) > 3000:
            cleaned_code = self.summarize_code(cleaned_code)
        
        # 작업별 프롬프트 템플릿
        prompt = self.get_prompt_template(task).format(
            code=cleaned_code,
            guidelines=self.get_guidelines(task)
        )
        
        return prompt
    
    def call_openai_with_cache(self, prompt, task_id):
        """
        캐시를 활용한 API 호출
        - 동일한 코드는 캐시에서 반환
        - API 호출 횟수 제한
        """
        cache_key = hashlib.md5(prompt.encode()).hexdigest()
        
        cached_result = self.cache.get(cache_key)
        if cached_result:
            return cached_result
            
        # Rate limiting
        self.token_limiter.wait_if_needed()
        
        try:
            response = openai.ChatCompletion.create(
                model="gpt-4-0613",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=2000
            )
            
            result = response.choices[0].message.content
            
            # 결과 캐싱 (24시간)
            self.cache.set(cache_key, result, expire=86400)
            
            return result
            
        except openai.error.RateLimitError:
            time.sleep(60)  # 1분 대기 후 재시도
            return self.call_openai_with_cache(prompt, task_id)
```

### 3. 카테고리 분류 시스템

코드의 유형과 작업 종류를 자동으로 분류하는 시스템을 구축했다. 이를 통해 적절한 처리 파이프라인을 선택할 수 있다.

```python
# cls_model 구현
class CodeCategoryClassifier:
    def __init__(self, model_path):
        self.model = self.load_model(model_path)
        self.tokenizer = AutoTokenizer.from_pretrained('microsoft/codebert-base')
        
        self.categories = {
            'api_endpoint': '웹 API 엔드포인트 코드',
            'database_query': '데이터베이스 쿼리 관련',
            'business_logic': '비즈니스 로직 구현',
            'util_function': '유틸리티 함수',
            'test_code': '테스트 케이스 코드',
            'config_file': '설정 파일',
            'frontend_component': '프론트엔드 컴포넌트'
        }
    
    def predict(self, code):
        """
        코드 카테고리 예측
        - CodeBERT 기반 임베딩
        - 분류 정확도 85% 이상
        """
        # 토큰화
        inputs = self.tokenizer(
            code, 
            truncation=True, 
            padding=True, 
            max_length=512,
            return_tensors='pt'
        )
        
        # 예측
        with torch.no_grad():
            outputs = self.model(**inputs)
            predictions = torch.softmax(outputs.logits, dim=-1)
            
        predicted_class = torch.argmax(predictions, dim=1).item()
        confidence = torch.max(predictions, dim=1)[0].item()
        
        return {
            'category': list(self.categories.keys())[predicted_class],
            'confidence': confidence,
            'description': list(self.categories.values())[predicted_class]
        }
```

## 핵심 기능 구현

### 1. 자동 문서 생성

코드를 분석하여 API 문서를 자동으로 생성하는 기능을 구현했다.

```python
def generate_api_documentation(self, code):
    """
    API 문서 자동 생성
    - FastAPI/Flask 엔드포인트 분석
    - 파라미터, 응답 형식 추출
    - 스웨거 문서 생성
    """
    # 코드 AST 분석
    ast_tree = ast.parse(code)
    endpoints = self.extract_endpoints(ast_tree)
    
    docs = []
    for endpoint in endpoints:
        # GPT-4로 상세 설명 생성
        description = self.openai_client.generate_description(
            endpoint['code'],
            endpoint['method'],
            endpoint['path']
        )
        
        doc = {
            'path': endpoint['path'],
            'method': endpoint['method'],
            'description': description,
            'parameters': self.extract_parameters(endpoint),
            'responses': self.extract_responses(endpoint)
        }
        docs.append(doc)
    
    return self.format_swagger_docs(docs)
```

### 2. 코드 품질 분석

정적 분석과 AI 분석을 결합한 코드 품질 검사 시스템을 구축했다.

```python
def analyze_code_quality(self, code):
    """
    코드 품질 분석
    - 정적 분석: pylint, flake8
    - AI 분석: 로직 복잡도, 가독성
    - 개선 제안: GPT-4 기반
    """
    # 정적 분석
    static_issues = self.run_static_analysis(code)
    
    # AI 기반 분석
    complexity_score = self.analyze_complexity(code)
    readability_score = self.analyze_readability(code)
    
    # 종합 점수 계산
    quality_score = self.calculate_quality_score(
        static_issues, 
        complexity_score, 
        readability_score
    )
    
    # 개선 제안 생성
    if quality_score < 70:
        suggestions = self.generate_improvement_suggestions(code)
    
    return {
        'score': quality_score,
        'issues': static_issues,
        'suggestions': suggestions,
        'metrics': {
            'complexity': complexity_score,
            'readability': readability_score
        }
    }
```

### 3. 테스트 케이스 생성

함수 시그니처를 분석하여 테스트 케이스를 자동으로 생성하는 기능이다.

```python
def generate_test_cases(self, function_code):
    """
    테스트 케이스 자동 생성
    - 함수 시그니처 분석
    - Edge case 식별
    - pytest 코드 생성
    """
    # 함수 분석
    func_info = self.analyze_function(function_code)
    
    # GPT-4로 테스트 케이스 생성
    test_prompt = f"""
    다음 함수에 대한 pytest 테스트 케이스를 생성해주세요:
    
    함수: {func_info['name']}
    파라미터: {func_info['parameters']}
    반환 타입: {func_info['return_type']}
    
    다음을 포함해주세요:
    - 정상 케이스 3개
    - Edge case 2개
    - 에러 케이스 1개
    """
    
    test_code = self.openai_client.generate_code(test_prompt)
    
    # 문법 검사 및 수정
    validated_code = self.validate_and_fix_syntax(test_code)
    
    return validated_code
```

## 트러블슈팅과 최적화

### 1. API 비용 최적화

초기에는 OpenAI API 비용이 한 달에 500달러까지 올라가는 문제가 있었다.

**최적화 방법:**
```python
# 비용 절감 전략
1. 캐싱 시스템 도입: 40% 비용 절감
2. 프롬프트 압축: 20% 비용 절감
3. 로컬 모델 활용: 30% 비용 절감
4. 배치 처리: 10% 비용 절감

# 결과: 월 500달러 → 150달러 (70% 절감)
```

### 2. 응답 시간 최적화

사용자 경험을 위해 응답 시간을 3초 이내로 줄여야 했다.

```python
async def process_code_async(self, code, task):
    """
    비동기 처리로 응답 시간 단축
    - 병렬 처리: 로컬 분석 + OpenAI 호출
    - 스트리밍 응답: 결과가 나오는 대로 전송
    """
    # 병렬 작업 시작
    local_task = asyncio.create_task(
        self.analyze_locally(code)
    )
    
    if self.needs_openai_analysis(code):
        openai_task = asyncio.create_task(
            self.analyze_with_openai(code)
        )
        
        # 스트리밍 응답 시작
        yield {"status": "analyzing", "progress": 30}
        
        # 결과 수집
        local_result = await local_task
        openai_result = await openai_task
        
        yield {"status": "complete", "result": {
            "local": local_result,
            "ai": openai_result
        }}
    else:
        result = await local_task
        yield {"status": "complete", "result": result}
```

### 3. 모델 로딩 안정성

서버 재시작 시 모델 로딩 실패 문제를 해결했다.

```python
def load_models_with_fallback(self):
    """
    폴백 메커니즘을 갖춘 모델 로딩
    - 기본 모델 로딩 실패 시 경량 모델로 대체
    - 헬스체크로 모델 상태 모니터링
    """
    models_to_load = [
        ('category', 'models/category_classifier.pth'),
        ('complexity', 'models/complexity_analyzer.pth'),
        ('style', 'models/style_checker.pth')
    ]
    
    for name, path in models_to_load:
        try:
            model = torch.load(path, map_location=self.device)
            self.models[name] = model
            logger.info(f"{name} model loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to load {name} model: {e}")
            
            # 폴백 모델 로딩
            fallback_path = f"models/fallback_{name}.pth"
            if os.path.exists(fallback_path):
                self.models[name] = torch.load(fallback_path)
                logger.info(f"Loaded fallback {name} model")
```

## 성능 지표와 결과

**개발 생산성 향상:**
- API 문서 작성 시간: 2시간 → 15분 (87% 단축)
- 코드 리뷰 시간: 1시간 → 20분 (67% 단축)
- 테스트 케이스 작성: 30분 → 5분 (83% 단축)

**시스템 성능:**
- 평균 응답 시간: 2.3초
- 코드 분류 정확도: 89%
- 문서 생성 품질: 4.2/5점 (개발자 평가)

**비용 효율성:**
- OpenAI API 비용: 70% 절감
- 개발 시간 절약: 주당 15시간
- ROI: 350% (3개월 기준)

## 향후 개선 계획

1. **다국어 지원**: 다양한 프로그래밍 언어 지원 확대
2. **실시간 코드 분석**: IDE 플러그인 개발
3. **팀 협업 기능**: 코드 리뷰 자동화
4. **성능 모니터링**: 코드 품질 변화 추적

Code Assistant 개발을 통해 AI를 실제 개발 워크플로우에 통합하는 과정의 복잡성과 가능성을 동시에 경험할 수 있었다. 단순한 자동화를 넘어 개발자의 창의성을 지원하는 도구로서의 AI의 잠재력을 확인했다.