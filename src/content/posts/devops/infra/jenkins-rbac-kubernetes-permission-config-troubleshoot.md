---
title: 'Jenkins RBAC: Kubernetes watch 권한 누락으로 인한 배포 실패 삽질기'
description: kubectl rollout status가 내부적으로 watch 권한을 요구한다는 사실을 몰라서 겪은 Jenkins RBAC
  트러블슈팅
pubDatetime: 2026-01-18
tags:
- Jenkins
- RBAC
- Kubernetes
- ClusterRole
- DevOps
- 트러블슈팅
- 쿠버네티스
- 권한
---


## 배경

Jenkins 파이프라인에서 `kubectl rollout status` 명령으로 배포 완료 여부를 확인하는 단계가 있었다. 그런데 이 명령이 계속 `Error from server (Forbidden): ...` 에러를 뱉으면서 실패했다. `list`, `get` 권한은 분명히 부여했는데도 불구하고.

## 문제 상황

```bash
# Jenkins 파이프라인 배포 단계 에러
$ kubectl rollout status deployment/xgen-core -n xgen
Error from server (Forbidden): deployments.apps "xgen-core" is forbidden:
User "system:serviceaccount:jenkins:jenkins" cannot watch resource
"deployments" in API group "apps" in the namespace "xgen"
```

`watch` 권한이 없다는 에러다. `kubectl rollout status`가 단순히 현재 상태를 `get`하는 명령이 아니라, 내부적으로 `watch`를 사용해 롤아웃 완료 이벤트를 기다린다는 사실을 몰랐다.

## 기존 ClusterRole

처음 작성한 ClusterRole은 이렇게 생겼다.

```yaml
# jenkins-clusterrole.yaml (수정 전)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: jenkins-deploy
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "patch", "update"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list"]
```

`watch`가 빠져 있다. `get`으로 상태를 확인할 수 있다고 생각했지만, `rollout status`의 동작 방식이 달랐다.

## kubectl rollout status 내부 동작

`kubectl rollout status`는 다음 순서로 동작한다.

1. 초기에 `get` 요청으로 현재 Deployment 상태 조회
2. 롤아웃이 완료되지 않았으면 Watch API를 열어 이벤트 스트림 대기
3. Deployment의 `observedGeneration >= generation` 조건이 만족되면 완료

Watch API는 HTTP long-polling과 비슷한 방식으로 동작한다. `--watch` 옵션을 붙인 것과 동일하게 서버에서 이벤트를 스트리밍받는다. 이를 위해 `watch` verb가 별도로 필요하다.

```bash
# 아래 두 명령어가 내부적으로 같은 권한을 필요로 함
kubectl get deployments --watch
kubectl rollout status deployment/xgen-core
```

Kubernetes RBAC에서 `watch`는 `list`, `get`과 별개의 verb다. `list`가 있어도 `watch`가 없으면 Watch API 호출이 실패한다.

## 수정된 ClusterRole

```yaml
# jenkins-clusterrole.yaml (수정 후)
# # 커밋: Jenkins ClusterRole에 watch verb 추가 (rollout status 실패 해결)
# # 날짜: 2024-09-05
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: jenkins-deploy
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "patch", "update"]
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["services", "configmaps"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["events"]
  verbs: ["list", "watch"]
```

`replicasets`와 `events`도 추가했다. `rollout status`는 ReplicaSet 상태도 확인하기 때문이다. 또한 배포 실패 시 이벤트를 읽어야 원인 파악이 가능하다.

## ClusterRoleBinding

ClusterRole을 만들었으면 Jenkins ServiceAccount에 바인딩해야 한다.

```yaml
# # 커밋: Jenkins ServiceAccount에 jenkins-deploy ClusterRole 바인딩
# # 날짜: 2024-09-05
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: jenkins-deploy-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: jenkins-deploy
subjects:
- kind: ServiceAccount
  name: jenkins
  namespace: jenkins
```

ClusterRoleBinding은 네임스페이스를 가리지 않고 전체 클러스터에 적용된다. 특정 네임스페이스에만 권한을 부여하려면 `RoleBinding`(네임스페이스 범위)을 사용해야 한다.

## RBAC 권한 디버깅 방법

Jenkins에서 권한 에러가 발생할 때 확인하는 방법들이다.

```bash
# 특정 ServiceAccount의 권한 확인
kubectl auth can-i watch deployments \
    --as=system:serviceaccount:jenkins:jenkins \
    -n xgen

# 여러 권한 한꺼번에 확인
kubectl auth can-i --list \
    --as=system:serviceaccount:jenkins:jenkins \
    -n xgen

# 실제 에러 원인 확인 (audit log)
kubectl get events -n jenkins --sort-by='.lastTimestamp' | tail -20
```

`kubectl auth can-i`가 가장 직접적인 디버깅 도구다. 권한이 있으면 `yes`, 없으면 `no`를 반환한다.

```bash
$ kubectl auth can-i watch deployments \
    --as=system:serviceaccount:jenkins:jenkins \
    -n xgen
no

$ # ClusterRole 수정 후
$ kubectl auth can-i watch deployments \
    --as=system:serviceaccount:jenkins:jenkins \
    -n xgen
yes
```

## Jenkins에서 kubectl 사용하는 방법

Jenkins Pod에서 kubectl을 사용하려면 두 가지 방법이 있다.

**방법 1: kubeconfig Secret**
```yaml
# Jenkins Pod에 kubeconfig를 Secret으로 마운트
volumes:
- name: kubeconfig
  secret:
    secretName: jenkins-kubeconfig
```

**방법 2: In-cluster Config (ServiceAccount 자동 마운트)**

Jenkins가 K8s 내부에서 실행되면 ServiceAccount 토큰이 자동으로 마운트된다.

```bash
# /var/run/secrets/kubernetes.io/serviceaccount/token
# kubectl이 이 토큰을 자동으로 사용
```

XGEN 2.0 Jenkins는 K3s 내부에서 실행되므로 방법 2를 사용했다. kubeconfig 없이 ServiceAccount 토큰만으로 kubectl이 작동한다.

## 권한 최소화 원칙

처음에는 `*` verb로 모든 권한을 주고 싶은 유혹이 있었다. 하지만 Jenkins는 CI/CD 도구라 빌드/배포에 필요한 최소 권한만 부여해야 한다.

```yaml
# 안티패턴 — 절대 금지
rules:
- apiGroups: ["*"]
  resources: ["*"]
  verbs: ["*"]
```

Jenkins에 필요한 최소 권한은:
- `deployments`: get, list, watch (rollout status), patch (image 업데이트)
- `pods`: get, list, watch (롤아웃 상태 확인)
- `replicasets`: get, list, watch
- `events`: list (에러 디버깅)

Secret이나 ConfigMap 수정 권한은 배포에 필요하지 않으면 부여하지 않는다.

## 결과

- `watch` verb 추가로 `kubectl rollout status` 정상 동작
- `kubectl auth can-i`로 권한 사전 검증 가능
- Jenkins ServiceAccount 최소 권한 원칙 적용

Kubernetes RBAC에서 `watch`가 `list`와 별개라는 점은 의외로 많이 놓치는 부분이다. `kubectl rollout status` 외에도 `kubectl wait` 명령도 동일하게 `watch` 권한이 필요하다.
