#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const WEBMASTERS_API = "https://www.googleapis.com/webmasters/v3";
const INSPECTION_API =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const DEFAULT_SITE = "sc-domain:infoedu.co.kr";
const DEFAULT_SITEMAP = "https://infoedu.co.kr/sitemap.xml";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682";

const configDir = path.resolve(
  process.env.SEARCH_CONSOLE_CONFIG_DIR ?? ".search-console"
);
const clientFile = path.resolve(
  process.env.SEARCH_CONSOLE_CLIENT_FILE ?? path.join(configDir, "client.json")
);
const tokenFile = path.resolve(
  process.env.SEARCH_CONSOLE_TOKEN_FILE ?? path.join(configDir, "token.json")
);
const sessionFile = path.join(configDir, "oauth-session.json");
const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL ?? DEFAULT_SITE;
const sitemapUrl =
  process.env.SEARCH_CONSOLE_SITEMAP_URL ?? DEFAULT_SITEMAP;

function fail(message, details) {
  console.error(`Search Console: ${message}`);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
}

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    fail(`${label} file not found: ${file}`);
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} file is not valid JSON: ${file}`, {
      message: error.message,
    });
  }
}

function secureWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);

  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tempFile, file);
  fs.chmodSync(file, 0o600);
}

function loadClient() {
  const raw = readJson(clientFile, "OAuth client");
  const client = raw.installed ?? raw.web ?? raw;

  if (!client.client_id || !client.client_secret) {
    fail(
      `OAuth client file must contain client_id and client_secret: ${clientFile}`
    );
  }

  return {
    clientId: client.client_id,
    clientSecret: client.client_secret,
  };
}

function loadToken() {
  const token = readJson(tokenFile, "OAuth token");
  if (!token.refresh_token) {
    fail(`OAuth token file has no refresh_token: ${tokenFile}`);
  }
  return token;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function tokenRequest(parameters) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });
  const data = await parseResponse(response);

  if (!response.ok) {
    fail("OAuth token request failed", {
      status: response.status,
      error: data?.error,
      errorDescription: data?.error_description,
    });
  }

  return data;
}

async function accessToken(forceRefresh = false) {
  const client = loadClient();
  const token = loadToken();
  const hasUsableToken =
    token.access_token &&
    token.expires_at &&
    Number(token.expires_at) > Date.now() + 60_000;

  if (!forceRefresh && hasUsableToken) return token.access_token;

  const refreshed = await tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });

  const updated = {
    ...token,
    access_token: refreshed.access_token,
    token_type: refreshed.token_type ?? token.token_type ?? "Bearer",
    scope: refreshed.scope ?? token.scope ?? WEBMASTERS_SCOPE,
    expires_at: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
    refreshed_at: new Date().toISOString(),
  };
  secureWriteJson(tokenFile, updated);
  return updated.access_token;
}

async function googleRequest(url, options = {}, retry = true) {
  const token = await accessToken(!retry);
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body && { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401 && retry) {
    return googleRequest(url, options, false);
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    fail("Google Search Console API request failed", {
      method: options.method ?? "GET",
      url,
      status: response.status,
      error: data?.error ?? data,
    });
  }

  return data;
}

function siteEndpoint(suffix = "") {
  return `${WEBMASTERS_API}/sites/${encodeURIComponent(siteUrl)}${suffix}`;
}

function sitemapEndpoint(target = sitemapUrl) {
  return siteEndpoint(`/sitemaps/${encodeURIComponent(target)}`);
}

function kst(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function publicSitemap(sitemap) {
  return {
    path: sitemap.path,
    lastSubmitted: sitemap.lastSubmitted ?? null,
    lastSubmittedKst: kst(sitemap.lastSubmitted),
    lastDownloaded: sitemap.lastDownloaded ?? null,
    lastDownloadedKst: kst(sitemap.lastDownloaded),
    isPending: sitemap.isPending ?? null,
    isSitemapsIndex: sitemap.isSitemapsIndex ?? null,
    warnings: sitemap.warnings ?? "0",
    errors: sitemap.errors ?? "0",
    contents: sitemap.contents ?? [],
  };
}

async function authStart() {
  const client = loadClient();
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const redirectUri =
    process.env.SEARCH_CONSOLE_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  secureWriteJson(sessionFile, {
    state,
    verifier,
    redirectUri,
    createdAt: new Date().toISOString(),
  });

  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: WEBMASTERS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  console.log("Open this URL in your Google-account browser:\n");
  console.log(url.href);
  console.log(
    "\nAfter approval, the localhost page may fail to open. Copy the entire URL from the address bar."
  );
  console.log("Then run: node scripts/search-console.mjs auth finish");
}

async function readCallbackInput(argument) {
  if (argument) return argument.trim();

  if (!process.stdin.isTTY) {
    return fs.readFileSync(0, "utf8").trim();
  }

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const value = await terminal.question("Paste the complete callback URL: ");
  terminal.close();
  return value.trim();
}

async function authFinish(argument) {
  const client = loadClient();
  const session = readJson(sessionFile, "OAuth session");
  const input = await readCallbackInput(argument);

  let callback;
  try {
    callback = new URL(input);
  } catch {
    fail("Paste the complete localhost callback URL, not only the code.");
  }

  const error = callback.searchParams.get("error");
  if (error) fail(`Google authorization failed: ${error}`);

  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (!code) fail("The callback URL has no authorization code.");
  if (!state || state !== session.state) {
    fail("OAuth state does not match. Run auth start again.");
  }

  const token = await tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: session.verifier,
    grant_type: "authorization_code",
    redirect_uri: session.redirectUri,
  });
  if (!token.refresh_token) {
    fail(
      "Google returned no refresh_token. Revoke the app grant, run auth start again, and approve consent."
    );
  }

  const grantedScopes = String(token.scope ?? WEBMASTERS_SCOPE)
    .split(/\s+/)
    .filter(Boolean);
  const unexpectedScopes = grantedScopes.filter(
    scope => scope !== WEBMASTERS_SCOPE
  );
  if (unexpectedScopes.length > 0) {
    fail(
      "Google granted unexpected OAuth scopes. Remove the existing app grant, run auth start again, and approve only Search Console access.",
      { unexpectedScopes }
    );
  }

  if (Number(token.refresh_token_expires_in) > 0) {
    fail(
      "Google issued a time-limited refresh token. Set the OAuth app publishing status to In production, then run auth start again.",
      { refreshTokenExpiresIn: Number(token.refresh_token_expires_in) }
    );
  }

  secureWriteJson(tokenFile, {
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    token_type: token.token_type ?? "Bearer",
    scope: grantedScopes.join(" "),
    expires_at: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    created_at: new Date().toISOString(),
  });
  if (fs.existsSync(sessionFile)) fs.rmSync(sessionFile);

  console.log(`OAuth credentials saved securely to ${tokenFile}`);
  await status();
}

async function listSitemaps() {
  const data = await googleRequest(siteEndpoint("/sitemaps"));
  return (data?.sitemap ?? []).map(publicSitemap);
}

async function status() {
  const sites = await googleRequest(`${WEBMASTERS_API}/sites`);
  const property = (sites?.siteEntry ?? []).find(site => site.siteUrl === siteUrl);
  const sitemaps = property ? await listSitemaps() : [];

  console.log(
    JSON.stringify(
      {
        siteUrl,
        propertyFound: Boolean(property),
        permissionLevel: property?.permissionLevel ?? null,
        sitemap: sitemaps.find(item => item.path === sitemapUrl) ?? null,
      },
      null,
      2
    )
  );

  if (!property) process.exitCode = 2;
}

async function sitemaps() {
  console.log(JSON.stringify(await listSitemaps(), null, 2));
}

async function submit(target = sitemapUrl) {
  await googleRequest(sitemapEndpoint(target), { method: "PUT" });
  const entries = await listSitemaps();

  console.log(
    JSON.stringify(
      {
        submitted: true,
        siteUrl,
        sitemap: entries.find(item => item.path === target) ?? { path: target },
      },
      null,
      2
    )
  );
}

async function inspect(target) {
  if (!target) fail("inspect requires a full URL.");

  let inspectionUrl;
  try {
    inspectionUrl = new URL(target).href;
  } catch {
    fail(`Invalid inspection URL: ${target}`);
  }

  const data = await googleRequest(INSPECTION_API, {
    method: "POST",
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
      languageCode: "ko-KR",
    }),
  });
  const result = data?.inspectionResult ?? {};
  const index = result.indexStatusResult ?? {};

  console.log(
    JSON.stringify(
      {
        inspectionUrl,
        inspectionResultLink: result.inspectionResultLink ?? null,
        verdict: index.verdict ?? null,
        coverageState: index.coverageState ?? null,
        indexingState: index.indexingState ?? null,
        robotsTxtState: index.robotsTxtState ?? null,
        pageFetchState: index.pageFetchState ?? null,
        lastCrawlTime: index.lastCrawlTime ?? null,
        lastCrawlTimeKst: kst(index.lastCrawlTime),
        googleCanonical: index.googleCanonical ?? null,
        userCanonical: index.userCanonical ?? null,
        sitemap: index.sitemap ?? [],
        referringUrls: index.referringUrls ?? [],
      },
      null,
      2
    )
  );
}

function help() {
  console.log(`Google Search Console manager

Usage:
  node scripts/search-console.mjs auth start
  node scripts/search-console.mjs auth finish [callback-url]
  node scripts/search-console.mjs status
  node scripts/search-console.mjs sitemaps
  node scripts/search-console.mjs submit [sitemap-url]
  node scripts/search-console.mjs inspect <full-url>

Local credentials:
  OAuth client: ${clientFile}
  OAuth token:  ${tokenFile}

Environment overrides:
  SEARCH_CONSOLE_CONFIG_DIR
  SEARCH_CONSOLE_CLIENT_FILE
  SEARCH_CONSOLE_TOKEN_FILE
  SEARCH_CONSOLE_SITE_URL
  SEARCH_CONSOLE_SITEMAP_URL
  SEARCH_CONSOLE_REDIRECT_URI`);
}

const [command = "help", subcommand, ...arguments_] = process.argv.slice(2);

switch (command) {
  case "auth":
    if (subcommand === "start") await authStart();
    else if (subcommand === "finish") await authFinish(arguments_[0]);
    else {
      help();
      process.exitCode = 1;
    }
    break;
  case "status":
    await status();
    break;
  case "sitemaps":
    await sitemaps();
    break;
  case "submit":
    await submit(subcommand);
    break;
  case "inspect":
    await inspect(subcommand);
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    help();
    process.exitCode = 1;
}
