import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const redirects = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/redirects.generated.json"), "utf8")
);
const config = fs.readFileSync(
  path.join(ROOT, "ops/caddy/sonblog-edge.caddy"),
  "utf8"
);

test("edge config includes every generated redirect exactly once", () => {
  const entries = Object.entries(redirects).sort(([left], [right]) =>
    left.localeCompare(right, "en")
  );

  for (const [index, [source, destination]] of entries.entries()) {
    const matcher = `legacy_${String(index + 1).padStart(4, "0")}`;
    assert.equal(
      config.split(`@${matcher} path ${JSON.stringify(source)}`).length - 1,
      1,
      source
    );
    assert.equal(
      config.split(`redir @${matcher} ${JSON.stringify(destination)} 301`)
        .length - 1,
      1,
      destination
    );
  }
});

test("edge config handles compatibility post URLs before proxying", () => {
  const redirect = "redir @compat_posts /{re.compat_posts.1} 301";
  assert.ok(config.includes("^/posts/(.+)$"));
  assert.ok(config.indexOf(redirect) < config.indexOf("reverse_proxy"));
});

test("edge proxy pins GitHub Pages while preserving the canonical host", () => {
  for (const suffix of [108, 109, 110, 111]) {
    assert.ok(config.includes(`https://185.199.${suffix}.153`));
  }
  assert.ok(config.includes("header_up Host infoedu.co.kr"));
  assert.ok(config.includes("tls_server_name infoedu.co.kr"));
});
