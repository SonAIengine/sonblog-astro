---
title: 'Istio + ArgoCD 도메인 변경: Helm values 수정 포인트 정리'
description: Kubernetes 환경에서 서비스 도메인을 변경할 때 Istio Gateway, ArgoCD Application, Helm
  values에서 수정해야 할 포인트를 정리한 실전 가이드.
pubDatetime: 2026-02-10
tags:
- DevOps
- K3s
- ArgoCD
- Istio
- 도메인
- 마이그레이션
- 쿠버네티스
---


## 배경

XGEN 2.0을 처음 구축할 때 스테이징 환경 도메인을 `xgen-stg.x2bee.com`으로 설정했다. "staging의 약자 stg"라는 관행적인 이름이었다.

그런데 롯데홈쇼핑 측에서 "xgen-stg"라는 이름이 임시(staging) 환경처럼 보인다는 피드백이 있었다. 실제로 롯데에 납품하는 환경은 제주 리전 서버를 사용했기 때문에 `jeju-xgen.x2bee.com`으로 변경하기로 했다.

도메인 하나를 바꾸는 게 단순해 보이지만, K3s + Istio + ArgoCD 조합에서는 수정해야 할 곳이 여러 군데 있었다.

## 수정이 필요한 위치

```
도메인이 참조되는 위치:
1. Helm values/       — 서비스별 ingress/host 설정
2. k3s/argocd/        — ArgoCD Project destinations
3. Istio Gateway      — VirtualService hosts
4. Jenkins pipeline   — 배포 후 확인 URL
5. 문서               — 배포 가이드, README
```

처음에 한 곳만 바꾸면 될 줄 알았다가 배포 후 Istio가 요청을 처리하지 못하는 문제가 발생해서 모든 위치를 찾아서 수정했다.

## 1단계: Helm values 수정

```bash
# # 커밋: feat: xgen-stg.x2bee.com 도메인 추가 (prd 환경에 jeju용 도메인 추가)
# # 날짜: 2026-02-10
# # 커밋: fix: 도메인 xgen-stg → jeju-xgen.x2bee.com 변경
# # 날짜: 2026-02-10
```

각 서비스의 values 파일에 ingress host가 지정되어 있다.

```yaml
# k3s/helm-chart/values/xgen-frontend.yaml

# 변경 전
environments:
  dev:
    ingress:
      enabled: true
      hosts:
        - host: xgen.x2bee.com    # dev는 유지
          paths: ["/"]
  prd:
    ingress:
      enabled: true
      hosts:
        - host: xgen.x2bee.com
          paths: ["/"]
        - host: xgen.infoedu.co.kr
          paths: ["/"]
        - host: xgen-stg.x2bee.com     # ← 이것을 변경
          paths: ["/"]

# 변경 후
environments:
  dev:
    ingress:
      enabled: true
      hosts:
        - host: xgen.x2bee.com
          paths: ["/"]
  prd:
    ingress:
      enabled: true
      hosts:
        - host: xgen.x2bee.com
          paths: ["/"]
        - host: xgen.infoedu.co.kr
          paths: ["/"]
        - host: jeju-xgen.x2bee.com    # ← 변경됨
          paths: ["/"]
```

xgen-frontend뿐 아니라 xgen-core, xgen-backend-gateway 등 외부에서 접근하는 모든 서비스의 values 파일을 수정했다.

## 2단계: ArgoCD Project destinations 수정

ArgoCD Project에 `destinations` 설정으로 배포 가능한 환경을 제한하고, 도메인 정보도 포함했다.

```yaml
# k3s/argocd/projects/xgen.yaml

# 변경 전
spec:
  destinations:
  - namespace: xgen
    server: https://kubernetes.default.svc
    name: dev-cluster
  - namespace: xgen
    server: https://kubernetes.default.svc
    name: prd-cluster
    # domain 정보 없음

# 변경 후 (domain 파라미터 추가)
spec:
  destinations:
    prd:
      server: https://kubernetes.default.svc
      domain: "jeju-xgen.x2bee.com"    # prd는 jeju-xgen
    dev:
      server: https://kubernetes.default.svc
      domain: "xgen.x2bee.com"         # dev는 xgen
```

ArgoCD ApplicationSet에서 이 domain 값을 Helm values에 주입한다.

```yaml
# ApplicationSet template
template:
  spec:
    source:
      helm:
        parameters:
        - name: "global.domain"
          value: "{{domain}}"    # destinations의 domain 참조
```

이렇게 하면 동일한 Helm chart를 dev/prd 환경에 배포할 때 도메인만 자동으로 달라진다.

## 3단계: Istio Gateway/VirtualService 수정

Istio를 사용하는 경우 Gateway와 VirtualService에도 호스트가 명시된다.

```yaml
# k3s/helm-chart/templates/gateway.yaml

# 변경 전
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: xgen-gateway
spec:
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - "xgen.x2bee.com"
    - "xgen-stg.x2bee.com"    # ← 변경
    - "xgen.infoedu.co.kr"

# 변경 후
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: xgen-gateway
spec:
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - "xgen.x2bee.com"
    - "jeju-xgen.x2bee.com"   # ← 변경됨
    - "xgen.infoedu.co.kr"
```

VirtualService의 hosts도 같이 수정해야 한다.

```yaml
# k3s/helm-chart/templates/virtualservice.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: xgen-vs
spec:
  hosts:
  - "xgen.x2bee.com"
  - "jeju-xgen.x2bee.com"   # ← 변경
  - "xgen.infoedu.co.kr"
  gateways:
  - xgen-gateway
```

Gateway와 VirtualService 중 하나만 바꾸면 도메인이 Gateway에서 인식되거나, VirtualService 라우팅에서 누락되거나 한다. 반드시 둘 다 변경해야 한다.

## 4단계: DNS 등록

외부 DNS(infoedu.co.kr은 공인 도메인, x2bee.com은 내부 도메인)에 새 도메인을 등록했다.

**x2bee.com 내부 DNS (Technitium)**:
```
jeju-xgen.x2bee.com  A  10.144.158.11
```

롯데 서버의 내부 IP로 직접 등록했다. 외부에서는 이 도메인으로 접근이 안 되고, VDI에서만 접근 가능하다.

## 도메인 마이그레이션 체크리스트

이 작업을 하면서 정리한 체크리스트다.

```
도메인 변경 전 확인:
□ 현재 도메인 사용 중인 서비스 목록 파악
□ Helm values에서 호스트 설정 위치 확인
□ Istio Gateway/VirtualService 존재 여부 확인
□ ArgoCD 설정에 도메인 정보 포함 여부

변경 작업:
□ DNS 새 도메인 등록 (A 레코드)
□ Helm values 모든 서비스 수정
□ Istio Gateway hosts 수정
□ Istio VirtualService hosts 수정
□ ArgoCD destination domain 수정
□ cert-manager Certificate dnsNames 수정 (HTTPS 사용 시)

변경 후 확인:
□ ArgoCD sync 완료
□ kubectl get ingress -n xgen 에서 새 도메인 확인
□ curl https://jeju-xgen.x2bee.com/health 응답 확인
□ 브라우저에서 직접 접근 테스트
□ 이전 도메인(xgen-stg.x2bee.com) 접근 불가 확인
```

## 삽질: 도메인 오타

```bash
# # 커밋: fix: 도메인 오타 수정 (infroedu → infoedu)
# # 날짜: 2026-02-16
```

동시에 진행하던 infoedu.co.kr 도메인 추가 작업에서 오타가 있었다. `infoedu.co.kr`을 `infroedu.co.kr`로 입력한 것이다. ArgoCD sync 후 브라우저에서 "도메인 없음" 에러가 나서 확인해보니 VirtualService에 잘못된 도메인이 등록돼 있었다.

```yaml
# 오타가 있던 VirtualService
hosts:
- "xgen.infoedu.co.kr"
- "xgen.infroedu.co.kr"   # ← 오타 (r이 끼어들었음)
```

Helm values에 직접 도메인 문자열을 쓰는 경우 이런 오타가 생기기 쉽다. ArgoCD에서 설정한 `global.domain` 파라미터를 활용하면 한 곳에서만 관리할 수 있다.

## 최종 도메인 구성

```
환경별 도메인 현황:

DEV (개발 서버 - 사내):
  - xgen.x2bee.com         → K3s dev cluster
  - xgen.infoedu.co.kr     → 외부 접근용 (Let's Encrypt TLS)

PRD (롯데홈쇼핑 서버):
  - jeju-xgen.x2bee.com    → K3s prd cluster (내부 DNS)
  - TLS 없음 (폐쇄망, ACME 챌린지 불가)
```

## 결과

- `xgen-stg.x2bee.com` → `jeju-xgen.x2bee.com` 전환 완료
- Helm values, Istio Gateway/VirtualService, ArgoCD destination 전체 업데이트
- DNS A 레코드 등록으로 롯데 VDI에서 접근 가능
- ArgoCD `global.domain` 파라미터로 환경별 도메인 중앙 관리

도메인 변경은 단순해 보이지만 Istio 환경에서는 수정 위치가 많다. 변경 전에 도메인이 참조되는 모든 위치를 파악하는 것이 핵심이다.
