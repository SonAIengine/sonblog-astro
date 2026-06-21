# Search Service Deployment

검색 API는 정적 GitHub Pages와 별도로 홈서버에서 운영한다.

## 구조

공개 포트는 계속 `8182`를 사용한다. 단, 무거운 synaptic backend를 직접 `8182`에 띄우지 않고 얇은 proxy를 둔다.

```text
search.infoedu.co.kr
  -> 8182 sonblog-search-proxy.service
    -> 8192 sonblog-search-backend@8192.service
    -> 8194 sonblog-search-backend@8194.service
```

현재 active backend는 `search-service/runtime/active-backend.json`에 기록된다. proxy는 요청마다 이 파일을 읽기 때문에 새 backend가 준비된 뒤 파일을 원자적으로 교체하면 트래픽이 바로 넘어간다.

## 배포

```bash
pnpm run search:deploy
```

이 스크립트는 다음 순서로 동작한다.

1. `ops/systemd/*.service`를 `~/.config/systemd/user`로 복사한다.
2. 비활성 backend port를 고른다. 기본값은 `8192,8194`다.
3. 새 backend를 시작하고 `/health`와 smoke search가 성공할 때까지 기다린다.
4. `runtime/active-backend.json`을 새 backend로 바꾼다.
5. proxy가 꺼져 있으면 시작한다.
6. 이전 backend를 끄고 새 backend/proxy를 enable한다.

기존 단일 서비스 `sonblog-search.service`가 아직 떠 있는 첫 전환에서는 새 backend를 먼저 준비한 뒤, 마지막에 기존 서비스를 멈추고 proxy를 `8182`에 붙인다.

## 상태 확인

```bash
curl -sS https://search.infoedu.co.kr/health | jq .
systemctl --user status sonblog-search-proxy.service --no-pager
systemctl --user status 'sonblog-search-backend@*.service' --no-pager
```

`/health`에는 backend의 `docs`, `morphology`, `aliases`, `graphCache`, `startupMs`, `startupProfile`, `warmupStatus`와 proxy의 active backend 정보가 함께 나온다.

## Graph Cache

backend startup에서 가장 오래 걸리던 부분은 `SynapticGraph.from_chunks()`가 매번 전체 노드를 다시 embedding하는 단계였다. 검색 앱은 `search-service/runtime/blog_graph_*.db.manifest.json`에 현재 코퍼스 fingerprint를 기록한다.

manifest가 현재 `dist/search-fulltext.json`, chunk 설정, embedding endpoint/model과 일치하고 DB의 모든 노드가 embedding을 가지고 있으면 startup은 기존 DB를 바로 열고 query-time embedder/reranker만 연결한다.

운영에서 기대하는 cache hit 상태:

```json
{
  "graphCache": "hit",
  "startupMs": 1700,
  "startupProfile": {
    "loadDocuments": 10,
    "prepareDocLookup": 85,
    "loadChunks": 22,
    "loadGraph": 28,
    "warmup": 1540
  },
  "warmupStatus": "done"
}
```

코퍼스를 강제로 재색인해야 할 때는 한 번만 아래처럼 실행한다.

```bash
FORCE_GRAPH_REBUILD=true pnpm run search:deploy
```

재색인 후 새 manifest가 기록되므로 다음 배포부터 다시 cache hit 경로를 탄다.

## Startup Fast Path

graph cache 이후에도 startup이 약 8초 걸리던 원인은 SQLite/HNSW open이 아니라 `prepare_doc_lookup()`에서 모든 글 본문을 Kiwi로 형태소 분석하던 비용이었다.

현재는 저장된 문서 쪽 lookup을 정규식 기반 토큰과 substring evidence로 처리하고, Kiwi 형태소 분석은 쿼리 분석에만 사용한다. 이 경로는 strict search eval을 통과하면서 warmup 전 startup profile을 약 130-150ms 수준으로 줄인다.

## 수동 롤백

이전 backend가 아직 살아 있다면 `runtime/active-backend.json`의 `port`와 `backend`를 이전 값으로 바꾸면 proxy가 즉시 이전 backend로 라우팅한다.

```json
{
  "port": 8192,
  "backend": "http://127.0.0.1:8192"
}
```

proxy 자체가 실패하면 기존 단일 서비스를 임시로 다시 시작할 수 있다.

```bash
systemctl --user stop sonblog-search-proxy.service
systemctl --user start sonblog-search.service
```

## 남은 개선

- cache hit startup profile은 warmup 전 약 150ms 수준이고, 첫 쿼리 cold-start 방지 warmup까지 포함하면 보통 1-2초 수준이다. 사용자가 체감하는 backend 전환 시간은 Python import, uvicorn, systemd start 비용이 더해진다.
- active backend 두 개를 동시에 오래 유지하면 메모리를 많이 쓴다. 배포 스크립트는 전환 후 비활성 backend를 정리한다.
- 외부 프록시가 `8182`만 바라보는 전제다. 외부 프록시까지 blue/green을 지원하게 바꾸면 proxy 계층 없이도 운영할 수 있다.
