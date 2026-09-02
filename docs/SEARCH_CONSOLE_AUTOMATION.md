# Google Search Console 자동 관리

`scripts/search-console.mjs`는 `infoedu.co.kr`의 Search Console 상태 조회, 사이트맵 제출,
개별 URL 색인 검사를 수행한다. 짧게 만료되는 access token을 직접 보관하지 않고,
장기 refresh token으로 실행할 때마다 access token을 자동 갱신한다.

## 왜 OAuth Playground 토큰을 그대로 쓰지 않는가

OAuth Playground 기본 앱과 Testing 상태의 OAuth 앱이 발급한 refresh token은 장기 운영용이
아니다. Google Cloud OAuth 앱을 `In production` 상태로 전환하고, 본인 전용 Desktop app
OAuth client를 사용한다.

refresh token은 일반적으로 계속 갱신에 사용할 수 있지만 절대 영구적인 것은 아니다.
사용자가 권한을 취소하거나, 6개월 이상 사용하지 않거나, 계정 정책이 바뀌면 다시 인증해야
할 수 있다. 월 1회 상태 조회를 실행하면 장기 미사용 상태를 피할 수 있다.

## 최초 1회 설정

1. Google Cloud Console에서 개인용 프로젝트를 만든다.
2. **APIs & Services > Library**에서 `Google Search Console API`를 활성화한다.
3. **Google Auth Platform > Audience**에서 앱을 `In production`으로 전환한다.
4. **Clients**에서 `Desktop app` OAuth client를 만들고 JSON을 다운로드한다.
5. 다운로드한 JSON을 아래 위치에 둔다.

   ```text
   .search-console/client.json
   ```

6. 파일 권한을 제한하고 인증 URL을 만든다.

   ```bash
   chmod 600 .search-console/client.json
   node scripts/search-console.mjs auth start
   ```

7. 출력된 URL을 Google 계정 브라우저에서 연 뒤 권한을 승인한다. 마지막 localhost 페이지가
   열리지 않아도 정상이다. 브라우저 주소창의 전체 URL을 복사한다.
8. 아래 명령을 실행하고 전체 callback URL을 붙여넣는다.

   ```bash
   node scripts/search-console.mjs auth finish
   ```

완료되면 `.search-console/token.json`에 refresh token이 권한 `600`으로 저장된다.
`.search-console/`은 Git에서 제외되므로 원격 저장소나 GitHub Pages에 포함되지 않는다.

## 운영 명령

현재 권한, 사이트맵 제출 및 처리 상태:

```bash
node scripts/search-console.mjs status
```

사이트맵 전체 목록:

```bash
node scripts/search-console.mjs sitemaps
```

기본 사이트맵 재제출:

```bash
node scripts/search-console.mjs submit
```

다른 사이트맵 제출:

```bash
node scripts/search-console.mjs submit https://infoedu.co.kr/sitemap-0.xml
```

Google 색인 상태 검사:

```bash
node scripts/search-console.mjs inspect \
  https://infoedu.co.kr/posts/ai/agent/insurance-ad-video-ai-compliance-qa-pipeline/
```

## 월 1회 자동 유지

Google은 refresh token을 6개월 이상 사용하지 않으면 무효화할 수 있다. 최초 인증을 완료한 뒤
아래 사용자 systemd timer를 등록하면 월 1회 `status`를 실행해 access token을 갱신하고
Search Console 연결 상태를 확인한다.

```bash
mkdir -p ~/.config/systemd/user
cp ops/systemd/sonblog-search-console-keepalive.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sonblog-search-console-keepalive.timer
systemctl --user list-timers sonblog-search-console-keepalive.timer
```

최근 실행 결과는 다음 명령으로 확인한다.

```bash
journalctl --user -u sonblog-search-console-keepalive.service -n 50
```

## 자격 증명 관리

- `.search-console/client.json`: Google Cloud OAuth client ID와 client secret
- `.search-console/token.json`: refresh token과 자동 갱신된 access token
- 두 파일 모두 로컬 전용이며 Git에 추가하지 않는다.
- 토큰 값을 명령행 인자로 넘기거나 로그에 출력하지 않는다.
- 월 1회 keepalive를 실행해도 사용자가 권한을 취소하거나 계정 정책이 바뀌면 다시 인증해야
  할 수 있다.
- 권한을 폐기하려면 Google 계정의 서드 파티 앱 연결에서 해당 앱의 접근을 삭제한다.
