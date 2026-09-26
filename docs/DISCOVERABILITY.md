# SON BLOG Discoverability Operations

이 문서는 `https://infoedu.co.kr`의 글을 Google, Bing, Naver와 AI 검색 서비스가 발견하고 이해할 수 있게 유지하는 운영 기준이다. 검색 노출은 보장할 수 없지만, 크롤링과 색인을 방해하는 기술 문제는 배포 때마다 확인한다.

## 공개 엔드포인트

- `/robots.txt`: 일반 검색 크롤러와 주요 AI 검색 크롤러의 접근을 허용한다.
- `/sitemap.xml`: Search Console과 검색엔진에 제출하는 대표 sitemap index다.
- `/sitemap-0.xml`: 공개 canonical HTML 페이지만 담는다.
- `/rss.xml`: 새 글 발견용 RSS feed다.
- `/feed_rss_created.xml`, `/feed_rss_updated.xml`: 예전 MkDocs RSS 주소를 현재 피드로 제공하는 호환 경로다. 크롤링 통계에서 두 주소의 요청이 90일 이상 사라진 뒤 제거할 수 있다.
- `/llms.txt`: 사이트 설명, topic guide, 대표 글, 최근 글을 제공한다.
- `/llms-full.txt`: 모든 공개 글의 제목, URL, 날짜, 태그, 설명을 제공한다.

`llms.txt`는 일부 AI 에이전트의 탐색을 돕기 위한 보조 문서다. Google은 검색 및 AI 검색 노출에 별도 AI 파일이나 특별한 schema가 필요하지 않다고 안내하며 `llms.txt`도 사용하지 않는다. Google 노출의 기본 조건은 Googlebot 접근, HTTP 200, 색인 가능한 본문, canonical, 내부 링크다.

## 배포 자동화

`main` 배포가 성공하면 `scripts/submit-indexnow.mjs`가 sitemap의 최근 변경 URL과 topic hub를 IndexNow에 제출한다. IndexNow 키는 프로토콜상 공개 파일이며 비밀값이 아니다. 알림 실패는 사이트 배포를 실패시키지 않는다.

전체 URL을 다시 알릴 필요가 있는 일회성 마이그레이션에서만 다음 명령을 쓴다.

```bash
node scripts/submit-indexnow.mjs --all
```

평소에는 변경일이 최근인 URL만 제출한다. 같은 URL을 반복해서 제출해도 크롤링이나 색인이 보장되지는 않는다.

## 발행 후 점검

1. 공개 URL이 로그인 없이 HTTP 200을 반환하는지 확인한다.
2. HTML의 canonical이 현재 공개 URL과 같은지 확인한다.
3. 글이 `/sitemap-0.xml`, `/rss.xml`, `/llms-full.txt`에 들어갔는지 확인한다.
4. 중요한 새 글은 Google Search Console URL 검사에서 실제 URL 테스트 후 색인을 한 번 요청한다.
5. Search Console의 페이지 색인, 실적 보고서는 며칠 지연될 수 있으므로 즉시 숫자가 늘지 않아도 재요청을 반복하지 않는다.

Search Console API는 sitemap 제출과 검색 실적 조회에는 사용할 수 있지만, 일반 블로그 글의 색인 생성을 API로 강제할 수는 없다. Google Indexing API는 일반 웹문서용이 아니다.

## URL 이전 원칙

- canonical 글 URL은 `src/content/posts`의 상대 경로를 그대로 사용한다. `/posts/`는 목록 페이지에만 쓴다.
- 기존 `/posts/<글 경로>/`는 새 canonical 글 URL로만 이동하며 sitemap, RSS, 내부 링크에는 넣지 않는다.
- `sonaiengine.github.io/sonblog`에는 본문 사본을 두지 않고 `infoedu.co.kr`의 동일 경로로 이동하는 페이지만 배포한다.
- 이전 경로는 가능한 한 최종 URL로 한 번에 연결한다. redirect chain, canonical 충돌, redirect URL의 sitemap 포함은 `scripts/audit-urls.mjs`가 실패 처리한다.
- URL 복구 배포 순서는 현재 사이트의 canonical 본문 배포, 구 GitHub Pages의 이동 페이지 배포, sitemap 1회 제출 순서다.

## 콘텐츠 기준

- 첫 문단에서 문제, 기존 방식의 한계, 결과를 설명한다.
- 실제 구현과 시행착오, 측정 근거를 남긴다. 여러 사이트에서 볼 수 있는 일반 설명만 반복하지 않는다.
- 관련 글 2~5개를 설명 문맥 안에서 연결한다.
- 글의 핵심을 보여주는 실제 화면, 구조도, 결과 그래프를 우선한다.
- 제목, description, `h2`가 독자가 찾는 질문과 글의 답을 구체적으로 표현해야 한다.
- 의미 있게 수정한 글은 `modDatetime`도 갱신해 sitemap과 IndexNow가 변경을 알 수 있게 한다.

## DNS와 도메인

외부 네트워크 접근성을 위해 아래 DNS 상태를 유지한다.

- apex A: GitHub Pages가 안내하는 IPv4 네 개
- apex AAAA: GitHub Pages가 안내하는 IPv6 네 개
- `www`: Technitium A 레코드로 홈 서버 Caddy를 가리키며 `https://infoedu.co.kr{uri}`로 301 이동한다.
- parent와 authoritative zone의 NS 집합 일치
- HTTPS 강제 적용

DNS 변경 뒤에는 로컬 resolver 하나만 보지 말고 Google Public DNS와 Cloudflare DNS에서도 A, AAAA, CNAME, NS 응답을 확인한다.

## 이전 소셜 이미지 경로

MkDocs가 공개했던 `/assets/images/social/<글 경로>.png`는 Astro 빌드 후 `scripts/restore-legacy-assets.mjs`가 글별 PNG로 복원한다. 현재 글의 기본 `og:image`도 이 경로를 사용한다. 디렉터리 대소문자가 달랐던 과거 주소도 함께 복원한다. 빌드에는 Noto Sans CJK KR 폰트가 필요하다. 과거 이미지 주소의 404 요청을 줄이기 위한 호환 조치이며, Google 글 색인을 보장하지는 않는다.

## 정기 확인

월 1회 다음을 확인한다.

- Search Console: 색인된 페이지, 제외 사유, 검색어, 노출, 클릭
- Bing Webmaster Tools: sitemap과 IndexNow 처리 상태
- Naver Search Advisor: 사이트 소유 확인, sitemap/RSS 수집 상태
- GoatCounter: 방문 페이지와 referrer
- Google/Bing에서 `site:infoedu.co.kr`과 대표 글 제목 검색

검색 결과 수는 진단용 근사치다. 최종 판단은 Search Console의 URL 검사와 페이지 색인 보고서를 함께 본다.
