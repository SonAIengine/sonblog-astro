// SON BLOG CMS용 GitHub OAuth 프록시 (Sveltia/Decap 표준).
// 정적 GitHub Pages는 토큰 교환(서버 시크릿)을 못 하므로, /admin CMS가
// 이 서비스로 GitHub OAuth 핸드셰이크를 위임한다.
//   /auth     → GitHub 로그인으로 리다이렉트
//   /callback → code를 access_token으로 교환 → 부모창에 postMessage
// 환경변수: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, (OAUTH_HOST, PORT)
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8183);
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const HOST = process.env.OAUTH_HOST || "https://cms-auth.infoedu.co.kr";
const SCOPE = process.env.OAUTH_SCOPE || "repo,user";
const GH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GH_TOKEN = "https://github.com/login/oauth/access_token";

function callbackPage(status, payload) {
  const msg = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return `<!doctype html><meta charset="utf-8"><script>
  (function () {
    function receive(e) {
      if (!e.data || e.data !== "authorizing:github") return;
      window.opener && window.opener.postMessage(${JSON.stringify(msg)}, e.origin);
      window.removeEventListener("message", receive, false);
    }
    window.addEventListener("message", receive, false);
    window.opener && window.opener.postMessage("authorizing:github", "*");
  })();
  </script>`;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, HOST);

  if (u.pathname === "/" || u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(`ok ${CLIENT_ID ? "configured" : "NO_CLIENT_ID"}`);
  }

  if (u.pathname === "/auth") {
    const state = crypto.randomBytes(12).toString("hex");
    const auth = new URL(GH_AUTHORIZE);
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", `${HOST}/callback`);
    auth.searchParams.set("scope", SCOPE);
    auth.searchParams.set("state", state);
    res.writeHead(302, {
      Location: auth.toString(),
      "Set-Cookie": `ostate=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    });
    return res.end();
  }

  if (u.pathname === "/callback") {
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    const ck = (req.headers.cookie || "").match(/ostate=([0-9a-f]+)/);
    if (!code) {
      res.writeHead(400);
      return res.end("missing code");
    }
    if (!ck || ck[1] !== state) {
      res.writeHead(403, { "Content-Type": "text/html" });
      return res.end(callbackPage("error", { error: "state mismatch" }));
    }
    try {
      const r = await fetch(GH_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: `${HOST}/callback`,
        }),
      });
      const data = await r.json();
      const ok = data && data.access_token;
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        ok
          ? callbackPage("success", { token: data.access_token, provider: "github" })
          : callbackPage("error", { error: data.error || "no token" })
      );
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/html" });
      return res.end(callbackPage("error", { error: String(e) }));
    }
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`[cms-auth] :${PORT}  client=${CLIENT_ID ? "set" : "MISSING"}`)
);
