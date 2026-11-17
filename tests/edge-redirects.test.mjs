import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const redirects = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/redirects.generated.json"), "utf8")
);
const edgeOnlyRedirects = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "ops/caddy/edge-only-redirects.generated.json"),
    "utf8"
  )
);
const config = fs.readFileSync(
  path.join(ROOT, "ops/caddy/sonblog-edge.caddy"),
  "utf8"
);
const compatibilityRules = new Map(
  [...config.matchAll(/@compat_(\d{4}) path ("(?:\\.|[^"\\])*")\n\s*redir @compat_\1 ("(?:\\.|[^"\\])*") 301/g)].map(
    match => [JSON.parse(match[2]), JSON.parse(match[3])]
  )
);
const edgeOnlyRules = new Map(
  [...config.matchAll(/@edge_(\d{4}) path_regexp ("(?:\\.|[^"\\])*")\n\s*redir @edge_\1 ("(?:\\.|[^"\\])*") 301/g)].map(
    match => [JSON.parse(match[2]), JSON.parse(match[3])]
  )
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

test("every compatibility post route reaches its exact-case canonical page", () => {
  const postsRoot = path.join(ROOT, "src/content/posts");
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(md|mdx)$/i.test(entry.name) && !entry.name.startsWith("_")) {
        files.push(file);
      }
    }
  }
  visit(postsRoot);

  const canonicalPaths = files
    .filter(file => !/^draft:\s*true\b/m.test(fs.readFileSync(file, "utf8")))
    .map(file =>
      `/${path.relative(postsRoot, file).split(path.sep).join("/").replace(/\.(md|mdx)$/i, "")}/`
    );
  assert.equal(compatibilityRules.size, canonicalPaths.length);
  assert.deepEqual(
    [...compatibilityRules.values()].sort(),
    canonicalPaths.sort()
  );

  assert.equal(
    compatibilityRules.get("/posts/search-engine/qdrant/semantic-search-tutorials/"),
    "/search-engine/Qdrant/semantic-search-tutorials/"
  );
  assert.equal(
    compatibilityRules.get("/posts/ai/xgen/qdrant-hybrid-search-sparse-dense-vector-integration/"),
    "/ai/XGEN/qdrant-hybrid-search-sparse-dense-vector-integration/"
  );
  assert.equal(
    compatibilityRules.get("/posts/search-engine/opensearch/vector-indexing/"),
    "/search-engine/OpenSearch/vector-indexing/"
  );
  assert.ok(config.indexOf("@compat_0001") < config.indexOf("reverse_proxy"));
  assert.ok(!config.includes("^/posts/(.+)$"));
});

test("historical case-only URLs redirect at the edge without shadowing posts", () => {
  assert.equal(edgeOnlyRules.size, Object.keys(edgeOnlyRedirects).length);

  for (const [source, destination] of Object.entries(edgeOnlyRedirects)) {
    const exactCasePath = `^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    assert.equal(edgeOnlyRules.get(exactCasePath), destination);
    assert.ok(new RegExp(exactCasePath).test(source));
    assert.ok(!new RegExp(exactCasePath).test(destination));
    assert.notEqual(source, destination);
    assert.equal(source.toLowerCase(), destination.toLowerCase());
    assert.ok(!(source in redirects));
    const relative = destination.replace(/^\/+|\/+$/g, "");
    assert.ok(
      [".md", ".mdx"].some(ext =>
        fs.existsSync(path.join(ROOT, "src/content/posts", `${relative}${ext}`))
      ),
      destination
    );
  }

  assert.equal(
    edgeOnlyRules.get("^/search-engine/Qdrant/Indexing/$"),
    "/search-engine/Qdrant/indexing/"
  );
  assert.equal(
    edgeOnlyRules.get("^/search-engine/Qdrant/Storage/$"),
    "/search-engine/Qdrant/storage/"
  );
});

test("historical section URLs lead to existing topic hubs", () => {
  for (const [source, destination] of [
    ["/search-engine/시맨틱 검색/", "/topics/search-engine/"],
    ["/ai/Model Serve/", "/topics/ai/"],
    ["/full-stack/python/기초/", "/topics/full-stack/"],
  ]) {
    assert.equal(redirects[source], destination);
    assert.ok(config.includes(`path ${JSON.stringify(source)}`));
  }
});

test("edge proxy pins GitHub Pages while preserving the canonical host", () => {
  for (const suffix of [108, 109, 110, 111]) {
    assert.ok(config.includes(`https://185.199.${suffix}.153`));
  }
  assert.ok(config.includes("header_up Host infoedu.co.kr"));
  assert.ok(config.includes("tls_server_name infoedu.co.kr"));
});
