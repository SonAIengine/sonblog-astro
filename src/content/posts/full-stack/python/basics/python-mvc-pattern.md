---
title: 파이썬의 MVC 패턴 구현
description: 파이썬에서 MVC(Model-View-Controller) 디자인 패턴을 적용하는 방법을 정리한다. 애플리케이션을 Model,
  View, Controller로 분리하여 유지보수성과 확장성을 높이는 구조를 다룬다.
pubDatetime: 2024-09-30
tags:
- Python
- MVC
- 디자인 패턴
- 아키텍처
- Full Stack
---


애플리케이션을 세 가지 주요 구성 요소로 나누어 관리하는 **디자인 패턴**

이 패턴은 유지 보수성과 확장성을 높이고, 코드의 역할을 명확하게 분리하여 개발을 더욱 체계적으로 할 수 있게 합니다.

```python
project_root/
├── main.py
├── app/
│   ├── __init__.py
│   ├── controllers/
│   │   ├── __init__.py
│   │   └── main_controller.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── data_model.py
│   ├── views/
│   │   ├── __init__.py
│   │   ├── main_view.py
│   │   └── ribbon_bar.py
│   └── resources/
│       ├── __init__.py
│       └── icons/
│           └── example_icon.png
├── config/
│   ├── __init__.py
│   └── settings.py
├── tests/
│   ├── __init__.py
│   ├── test_models.py
│   ├── test_views.py
│   └── test_controllers.py
└── requirements.txt
```

`main.py`: 애플리케이션의 시작점.

`app/`: 주요 애플리케이션 코드가 위치.

- `controllers/`: 컨트롤러 파일들이 위치하며, 비즈니스 로직과 뷰 간의 상호작용을 담당.
- `models/`: 데이터베이스 모델이나 비즈니스 데이터를 처리하는 로직이 위치.
- `views/`: 사용자에게 데이터를 렌더링하는 역할을 하는 파일들.
- `resources/`: 애플리케이션에서 사용하는 리소스들 (예: 이미지, 아이콘 등).

`config/`: 설정 파일들이 위치하며, 애플리케이션의 환경 설정을 정의.

`tests/`: 테스트 코드가 위치하며, 각 부분에 대한 유닛 테스트 파일들이 포함.

`requirements.txt`: 프로젝트에서 필요한 Python 패키지 목록.