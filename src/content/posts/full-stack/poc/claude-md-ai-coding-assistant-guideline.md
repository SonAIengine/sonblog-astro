---
title: CLAUDE.md로 AI 코딩 어시스턴트 가이드라인 작성하기
description: 팀 프로젝트에서 Claude Code가 일관된 방식으로 작업하도록 CLAUDE.md에 컨텍스트와 규칙을 기록하는 실전 가이드
pubDatetime: 2026-02-10
tags:
- Claude Code
- AI
- 개발 생산성
- 코딩 어시스턴트
- CLAUDE.md
- Full Stack
---


## 배경

XGEN 2.0 인프라 작업에서 Claude Code를 본격적으로 활용하기 시작했다. 처음에는 매번 대화에서 "이 레포는 K3s 기반이고, ArgoCD로 배포하고, 커밋 메시지는 이렇게 써야 하고..."를 다시 설명해야 했다. 컨텍스트가 없는 어시스턴트에게 매번 배경을 설명하는 건 비효율적이다.

`CLAUDE.md`는 Claude Code가 프로젝트 루트에서 자동으로 읽는 지침 파일이다. 여기에 프로젝트 구조, 작업 규칙, 금지사항을 적어두면 매번 설명할 필요 없이 일관된 방식으로 작업할 수 있다.

## CLAUDE.md의 역할

Claude Code는 세션 시작 시 다음 순서로 파일을 읽는다.

1. `~/.claude/CLAUDE.md` — 전역 설정 (사용자 수준)
2. 작업 디렉토리의 `CLAUDE.md` — 프로젝트 설정
3. 하위 디렉토리의 `CLAUDE.md` — 서브 프로젝트 설정

프로젝트별 CLAUDE.md에는 "이 레포에서만 적용되는 규칙"을 적는다.

## xgen-infra CLAUDE.md 초기 버전 (2026-01-14)

```bash
# # 커밋: Claude 설정 파일 버전 관리 추가
# # 날짜: 2026-01-14
```

처음 만든 CLAUDE.md는 기본적인 구조 설명과 작업 방식이었다.

```markdown
# XGEN 2.0 인프라 작업 가이드

## 프로젝트 구조
- docker/: Dockerfile 모음
- helm-chart/: K3s Helm Chart
- argocd/: ArgoCD Application 설정
- pipeline/: Jenkins 파이프라인
- k3s/: K3s 클러스터 설정

## Git 커밋 규칙
- 커밋 메시지 형식: `type: 변경 내용`
- user.name: 손성준, user.email: sonsj97@plateer.com
- ArgoCD: 자동 sync 활성화 (변경 감지 후 자동 배포)

## 주요 서비스 포트
- xgen-core: 8002
- xgen-workflow: 8003
- xgen-frontend: 3000
- xgen-backend-gateway: 8080
```

단순하다. 그런데 실제로 쓰다 보니 부족한 것들이 보였다.

## 반복되는 실수로 추가된 규칙들

### main 직접 push 금지

```bash
# # 커밋: docs: 작업 완료 시 브랜치+MR 절차로 변경 (main 직접 push 금지)
# # 날짜: 2026-02-10
# # 커밋: docs: CLAUDE.md main 직접 push 금지 규칙 강화 - 예외 없음
# # 날짜: 2026-02-18
```

Claude Code가 작업 완료 후 `git push origin main`을 직접 실행한 적이 있었다. 인프라 레포는 `main` → ArgoCD 자동 감지 → 즉시 배포로 연결되기 때문에 검토 없이 main에 직접 push하면 운영 서버에 바로 적용된다.

```markdown
## Git 작업 규칙

**절대 금지: main 직접 push**
- xgen-infra는 main 브랜치가 ArgoCD와 연동됨
- main push = 즉시 프로덕션 배포
- 반드시 feature 브랜치 생성 → 작업 → MR → 머지 절차

올바른 절차:
1. git checkout -b feature/작업내용
2. 작업 완료
3. git push origin feature/작업내용
4. GitLab에서 MR 생성 (대상: main)
5. 리뷰 후 머지

커밋 시 사용자 정보 명시:
git -c user.name="손성준" -c user.email="sonsj97@plateer.com" commit -m "..."
```

"예외 없음"을 명시한 것이 중요하다. "긴급 상황에는 직접 push"라는 예외를 열어두면 Claude Code가 스스로 긴급 상황이라고 판단해서 예외를 사용할 수 있다.

### 서버 접속 방법

```bash
# # 커밋: docs: CLAUDE.md에 로컬 서버 직접 접근 지침 추가 (도메인 사용 금지)
# # 날짜: 2026-02-07
```

Claude Code가 ArgoCD 상태를 확인하려고 `https://argocd.xgen.x2bee.com`에 curl을 날린 적이 있었다. 이 도메인은 내부 네트워크에서만 접근 가능하고 Claude Code가 실행되는 환경에서는 접근이 안 된다.

```markdown
## 서버 접속 방법

**도메인 접근 불가**: argocd.xgen.x2bee.com, grafana.xgen.x2bee.com 등은
외부에서 접근 불가 — 절대 curl이나 fetch 시도하지 말 것

**대신 로컬 포트포워딩 사용**:
- ArgoCD: kubectl port-forward svc/argocd-server -n argocd 8080:443
  → https://localhost:8080
- Grafana: kubectl port-forward svc/grafana -n observability 3000:80
  → http://localhost:3000
- Jenkins: http://localhost:30888 (NodePort)

또는 kubectl 명령으로 직접 확인:
- kubectl get pods -n xgen
- kubectl get application -n argocd
- argocd app list (argocd CLI)
```

### 소스코드 작업 방법

```bash
# # 커밋: docs: CLAUDE.md에 서비스 소스코드 작업 가이드(tmp/) 추가
# # 날짜: 2026-02-10
```

인프라 레포에서 작업하다 보면 각 서비스의 소스코드를 참조하거나 수정해야 할 때가 있다. 기본적으로 서비스 소스코드는 인프라 레포에 없고 각각의 레포에 있다.

```markdown
## 서비스 소스코드 작업

각 서비스 소스코드는 xgen-infra에 없음. 필요 시 tmp/ 디렉토리에 clone:

git clone https://oauth2:${GITLAB_TOKEN}@gitlab.x2bee.com/xgen2.0/xgen-core.git tmp/xgen-core

작업 후 tmp/ 디렉토리는 정리 (git에 커밋하지 않음, .gitignore에 포함)

## 현재 인프라 구조
- K3s 클러스터: 개발 서버 (192.168.x.x)
- ArgoCD: k3s 내부 설치, namespace=argocd
- Jenkins: k3s 내부 설치, namespace=jenkins, NodePort 30888
- Registry: Nexus (docker.x2bee.com)
- 배포 흐름: GitLab Push → Jenkins 빌드 → Nexus Push → ArgoCD Sync
```

## 슬래시 커맨드 (.claude/commands/)

CLAUDE.md와 함께 `.claude/commands/` 디렉토리에 커스텀 슬래시 커맨드를 만들었다.

```bash
# # 커밋: .claude/commands/ 슬래시 커맨드 5개 추가
# # 날짜: 2026-01-14
```

```
.claude/commands/
├── status.md        # /status: 전체 서비스 상태 확인
├── deploy-guide.md  # /deploy-guide: 배포 절차 요약
├── add-service.md   # /add-service: 새 서비스 추가 절차
├── check-gitlab.md  # /check-gitlab: GitLab MR/이슈 확인
└── validate.md      # /validate: helm template, yaml lint 실행
```

예를 들어 `status.md`:

```markdown
# 전체 서비스 상태 확인

다음 명령들을 순서대로 실행해서 현재 클러스터 상태를 확인한다:

1. Pod 상태: kubectl get pods -n xgen
2. ArgoCD 앱 상태: argocd app list
3. 최근 이벤트: kubectl get events -n xgen --sort-by='.lastTimestamp' | tail -20
4. Jenkins 빌드 상태: (Jenkins NodePort 30888 확인)

문제가 있으면 관련 Pod 로그를 확인:
kubectl logs -n xgen deployment/xgen-core --tail=100
```

`/status`를 입력하면 Claude Code가 이 파일의 내용을 프롬프트로 실행한다. 반복적으로 쓰는 명령 시퀀스를 커맨드로 만들어두면 효율적이다.

## CLAUDE.md 작성 노하우

실제로 쓰면서 효과가 있었던 패턴들이다.

### 금지사항은 이유와 함께

```markdown
# 나쁜 예
main에 직접 push 금지

# 좋은 예
main 직접 push 절대 금지:
이유: main push → ArgoCD 감지 → 즉시 프로덕션 배포
긴급 상황에도 예외 없음. 브랜치 → MR → 머지.
```

이유를 적으면 Claude Code가 비슷한 상황에서 스스로 판단할 수 있다.

### 현재 상태 vs 이상적 상태

```markdown
## 현재 알려진 이슈
- xgen-documents prd 환경: 메모리 limit 8Gi (OOMKilled 이력 있음, 모니터링 중)
- Grafana 알림: 243 서버(prd)에만 활성화됨

## 작업 시 주의사항
- helm upgrade 전 항상 dry-run 먼저
- ArgoCD sync 후 Pod 상태 확인 필수 (kubectl get pods -n xgen -w)
```

"현재 상태"를 적어두면 잘못된 가정으로 작업하는 것을 방지한다.

### 환경별 차이점 명시

```markdown
## 환경 구성
| 환경 | 클러스터 | 도메인 | ArgoCD 앱 |
|------|----------|--------|-----------|
| dev | K3s (개발서버) | xgen.x2bee.com | xgen-*-dev |
| prd | K3s (롯데 서버) | jeju-xgen.x2bee.com | xgen-*-prd |

dev와 prd는 서로 다른 물리 서버에 있음.
dev에서 테스트 후 prd에 수동 배포.
```

## CLAUDE.md의 한계

CLAUDE.md가 길어질수록 컨텍스트 윈도우를 많이 차지한다. 200줄 이상이 되면 일부 내용이 잘릴 수 있다. 중요한 규칙은 앞쪽에, 상세 내용은 별도 문서에 두고 CLAUDE.md에서 참조하는 방식이 낫다.

```markdown
# CLAUDE.md (간결하게)
자세한 배포 가이드: docs/deploy-guide.md
서버 접속 정보: docs/reference/server-info.md (git 미관리)
```

또한 CLAUDE.md는 Claude Code에만 적용된다. GitHub Copilot, Cursor 같은 다른 도구를 쓴다면 각 도구별 설정 파일을 따로 만들어야 한다.

## 결과

- 매 세션마다 프로젝트 배경 설명 불필요
- main 직접 push 사고 재발 방지
- 커스텀 슬래시 커맨드로 반복 작업 단축
- 팀원이 Claude Code를 쓸 때도 동일한 규칙 적용

CLAUDE.md는 프로젝트 문서의 일부다. 새로운 규칙이 생기거나 구조가 바뀌면 코드와 함께 업데이트하는 습관이 필요하다.
