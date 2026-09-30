# SON BLOG Edge

`sonblog-edge.caddy`는 `src/redirects.generated.json`의 과거 URL과 `/posts/<글 경로>/` 호환 URL을 실제 HTTP `301`로 응답한다. 그 외 요청은 GitHub Pages IPv4 원본으로 전달한다.

## 생성과 배치

```bash
pnpm run edge:redirects
cp ops/caddy/sonblog-edge.caddy ~/.config/sonblog/caddy/sonblog-edge.pending
mv ~/.config/sonblog/caddy/sonblog-edge.pending ~/.config/sonblog/caddy/sonblog-edge.caddy
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

운영 Caddy compose는 `~/.config/sonblog/caddy`를 `/etc/caddy/sonblog`에 읽기 전용으로 mount하고, 기본 Caddyfile에서 `/etc/caddy/sonblog/*.caddy`를 import해야 한다.

## 확인

```bash
curl -I https://infoedu.co.kr/
curl -I https://infoedu.co.kr/posts/ai/XGEN/qdrant-hybrid-search-sparse-dense-vector-integration/
curl -I https://infoedu.co.kr/sitemap.xml
```

첫 번째와 세 번째 요청은 `200`, 두 번째 요청은 canonical URL을 가리키는 `301`이어야 한다. apex DNS는 홈 서버 Caddy의 IPv4 A 레코드만 사용한다. 외부 IPv6 ingress가 없으면 apex AAAA 레코드를 추가하지 않는다.
