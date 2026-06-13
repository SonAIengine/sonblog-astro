---
title: 'Dockerfile 최적화: COPY --chown vs chown -R 레이어 중복 제거'
description: Frontend Dockerfile에서 불필요한 chown -R 레이어를 COPY --chown으로 통합해 이미지 크기와 빌드
  시간을 줄인 최적화 사례
pubDatetime: 2026-01-18
tags:
- Docker
- Dockerfile
- 최적화
- DevOps
- 도커
- 이미지 최적화
---


## 배경

xgen-frontend는 Next.js 앱이다. 빌드 후 실행 이미지에서 파일 소유권을 `nextjs:nodejs` 사용자로 변경하는 작업이 필요했다. 처음 작성된 Dockerfile은 흔히 볼 수 있는 패턴이었다.

```dockerfile
# 수정 전 Dockerfile (문제 있는 버전)
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 문제: COPY 후 별도 레이어로 소유권 변경
RUN chown -R nextjs:nodejs /app

USER nextjs
CMD ["node", "server.js"]
```

이 Dockerfile의 문제는 `chown -R nextjs:nodejs /app`이 별도 레이어를 만든다는 것이다. `/app` 디렉토리 전체의 메타데이터(소유권)를 변경하는 레이어가 추가되어, 실제 파일 데이터를 담은 레이어와 소유권 변경 레이어 두 개가 생긴다.

## 레이어 중복의 문제

Docker 이미지 레이어는 union filesystem으로 쌓인다. `chown -R`은 파일 내용을 바꾸지 않지만, 파일시스템 관점에서는 모든 파일의 메타데이터가 새 레이어에 기록된다.

```bash
# docker history로 레이어 확인 (수정 전)
docker history registry.x2bee.com/xgen-frontend:before

IMAGE         CREATED BY                                SIZE
sha256:abc    RUN chown -R nextjs:nodejs /app           45.2MB  ← 불필요한 레이어
sha256:def    COPY --from=builder /app/.next/static     12.3MB
sha256:ghi    COPY --from=builder /app/.next/standalone 32.8MB
```

`chown -R` 레이어가 45.2MB나 됐다. standalone 빌드의 파일 크기와 거의 동일하다 — 파일 내용 없이 소유권 메타데이터만으로 이 크기가 나온다.

## COPY --chown 적용

```dockerfile
# # 커밋: Dockerfile COPY --chown으로 chown -R 레이어 제거 (이미지 크기 최적화)
# # 날짜: 2024-09-08
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

WORKDIR /app

# COPY 시점에 소유권 지정 → chown 레이어 불필요
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
CMD ["node", "server.js"]
```

`COPY --chown=nextjs:nodejs`는 파일을 복사하는 동시에 소유권을 설정한다. 별도 레이어 없이 COPY 레이어 하나로 끝난다.

```bash
# docker history (수정 후)
docker history registry.x2bee.com/xgen-frontend:after

IMAGE         CREATED BY                                           SIZE
sha256:xyz    COPY --chown=nextjs:nodejs /app/public ./public      2.1MB
sha256:uvw    COPY --chown=nextjs:nodejs .next/static .next/static 12.3MB
sha256:rst    COPY --chown=nextjs:nodejs .next/standalone ./       32.8MB
```

45.2MB짜리 `chown -R` 레이어가 사라졌다.

## 왜 이미지 크기가 줄어드나

Union filesystem의 레이어 특성 때문이다. `chown -R`을 실행하면 변경된 메타데이터를 담은 새 레이어가 추가된다. 이전 레이어의 파일은 이미 있고, 새 레이어에 "소유권이 바뀐 동일 파일"이 중복으로 기록된다.

```
레이어 N (COPY):
  /app/server.js  (root:root)
  /app/.next/...  (root:root)

레이어 N+1 (chown -R):
  /app/server.js  (nextjs:nodejs)  ← 내용은 같지만 메타데이터 변경
  /app/.next/...  (nextjs:nodejs)  ← 레이어에 재기록
```

COPY --chown을 쓰면 레이어 N에 처음부터 올바른 소유권으로 기록되므로 중복이 없다.

## multi-stage build에서 소유권 유의사항

```dockerfile
FROM node:20-alpine AS builder
# builder 단계에서는 root로 실행
RUN npm ci && npm run build

FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# builder의 root 소유 파일을 runner에서 nextjs 소유로 복사
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
```

multi-stage build에서 `COPY --from=builder`를 쓸 때도 `--chown`을 지정할 수 있다. builder 이미지에서 root 소유였던 파일이 runner 이미지에서 nextjs 소유로 복사된다.

## 언제 chown -R이 필요한가

`COPY --chown`이 모든 상황을 커버하지는 않는다.

**chown -R이 여전히 필요한 경우:**
- 런타임에 생성되는 파일의 소유권 변경 (`/app/uploads`, `/app/logs` 등)
- 환경변수나 시크릿으로 주입되는 파일
- entrypoint 스크립트에서 동적으로 파일을 생성하는 경우

```dockerfile
# 런타임 디렉토리는 여전히 RUN으로 처리
RUN mkdir -p /app/logs /app/tmp && \
    chown -R nextjs:nodejs /app/logs /app/tmp
```

이런 경우는 어쩔 수 없지만, 디렉토리만 생성하는 것이라 크기가 작다.

## 실제 효과

| 구분 | 수정 전 | 수정 후 |
|------|---------|---------|
| 이미지 레이어 수 | 12개 | 11개 |
| chown 레이어 크기 | 45.2MB | 0MB |
| 최종 이미지 크기 | 182MB | 137MB |
| 이미지 푸시 시간 | 2분 10초 | 1분 35초 |

이미지가 45MB 줄었고, 레지스트리 푸시 속도도 개선됐다. 레이어 재사용률도 올라가서 동일 코드 변경 시 변경된 레이어만 푸시된다.

## Dockerfile 레이어 최적화 원칙 정리

실제 적용하면서 정리한 레이어 최적화 원칙들이다.

```dockerfile
# 나쁜 예: 불필요한 레이어 추가
COPY . .
RUN chown -R app:app .
RUN chmod +x entrypoint.sh

# 좋은 예: COPY 시점에 권한 설정
COPY --chown=app:app . .
```

```dockerfile
# 나쁜 예: RUN 명령 분리 (레이어 각각 생성)
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get clean

# 좋은 예: && 로 체이닝 (레이어 1개)
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*
```

```dockerfile
# 나쁜 예: 변경 빈도 높은 파일을 먼저 COPY
COPY . .
RUN npm ci

# 좋은 예: 변경 빈도 낮은 파일을 먼저 COPY (캐시 히트율 향상)
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

## 결과

- `COPY --chown`으로 불필요한 `chown -R` 레이어 제거
- xgen-frontend 이미지 크기 182MB → 137MB (24.7% 감소)
- 레지스트리 푸시 시간 단축
- 레이어 캐시 효율 개선

Docker 이미지 최적화는 빌드 시간과 배포 속도 모두에 영향을 준다. `COPY --chown`은 적용이 단순하면서 효과가 큰 최적화다.
