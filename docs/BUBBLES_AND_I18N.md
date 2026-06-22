# Bubbles and i18n Notes

## Bubbles 등록 준비

Bubbles는 개별 글 제출이 아니라 블로그 RSS를 등록해두고 새 글을 수집하는 방식이다.

현재 제출 정보:

- Blog: `https://infoedu.co.kr/`
- RSS: `https://infoedu.co.kr/rss.xml`
- robots: `BubblesBot` 명시 허용
- 성격: 개인 기술 블로그, 광고/페이월 없음, 원문 공개

제출 메일 예시:

```text
Subject: Blog suggestion for Bubbles: SON BLOG

Hi,

I'd like to suggest my personal technical blog for Bubbles:

https://infoedu.co.kr/
RSS: https://infoedu.co.kr/rss.xml

It is an independent personal blog where I write about search engines,
AI agents, LLM serving, DevOps, and side projects from my own work.
The posts are public, free to read, and the site has no ads or paywall.

robots.txt allows crawling, and BubblesBot is welcome.

Thanks!
```

## 다국어 적용 원칙

현재 블로그는 한국어 원문이 중심이다. 다국어는 다음 순서로 확장한다.

1. UI/메타/RSS/소개 페이지부터 다국어화한다.
2. `/en/`은 영문 방문자를 위한 소개 진입점으로 둔다.
3. 본문은 자동 번역본을 바로 공개하지 않는다.
4. 번역한 글은 원문과 같은 의미인지 사람이 검수한 뒤 별도 영어 URL을 연다.
5. 번역 URL을 열 때만 `hreflang`을 해당 글 단위로 연결한다.

본문 번역을 검수 없이 일괄 공개하면 “영문 URL + 한국어 또는 저품질 번역 본문”이 되어 SEO와 Bubbles 심사에 모두 불리할 수 있다.

## 자동 언어 선택

GitHub Pages는 정적 호스팅이라 서버가 방문자 IP를 보고 HTML 응답을 언어별로 바꿀 수 없다.

현재 적용 방식:

- 첫 방문이 `/`이고 사용자가 언어를 고른 기록이 없을 때 `navigator.languages`를 확인한다.
- 브라우저 기본 언어가 한국어가 아니면 `/en/`으로 1회 이동한다.
- 헤더의 `KO`/`EN` 선택은 `localStorage`에 저장한다.

이 방식은 IP 국가보다 프라이버시 부담이 낮고 GitHub Pages에서 바로 동작한다.

## IP 국가 기반이 꼭 필요할 때

국가별 IP 기반 언어 선택은 GitHub Pages만으로는 어렵다. 필요하면 Cloudflare Worker를 `infoedu.co.kr` 앞단에 두고 `CF-IPCountry` 헤더로 처리한다.

예시:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const country = request.headers.get("CF-IPCountry") || "";
    const cookie = request.headers.get("Cookie") || "";

    const hasLanguageChoice = cookie.includes("sonblog_locale=");
    const isHome = url.pathname === "/";

    if (isHome && !hasLanguageChoice && country !== "KR") {
      url.pathname = "/en/";
      return Response.redirect(url.toString(), 302);
    }

    return fetch(request);
  },
};
```

주의:

- `302`로 시작하고 충분히 검증한 뒤 `301`을 고려한다.
- 사용자가 직접 고른 언어는 쿠키로 우선한다.
- 검색 봇에는 과한 IP 리다이렉트를 적용하지 않는 편이 안전하다.
- 글 단위 번역이 준비되기 전에는 `/en/posts/...` 전체 복제를 만들지 않는다.
