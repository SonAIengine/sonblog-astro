import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";

type D2Meta = {
  layout?: "dagre" | "elk";
  sketch?: boolean;
  themeID?: number;
  darkThemeID?: number;
  pad?: number;
  scale?: number;
  center?: boolean;
};

const rendererPath = fileURLToPath(
  new URL("../../scripts/render-d2-block.mjs", import.meta.url)
);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseBoolean(value: string | undefined): boolean {
  return value === undefined || value === "true" || value === "1";
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMeta(meta: string | null | undefined): D2Meta {
  const options: D2Meta = {};
  if (!meta) return options;

  const tokens = meta.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const token of tokens) {
    const [rawKey, ...rawValueParts] = token.split("=");
    const key = rawKey.trim();
    const rawValue = rawValueParts
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key === "elk" || (key === "layout" && rawValue === "elk")) {
      options.layout = "elk";
    } else if (key === "dagre" || (key === "layout" && rawValue === "dagre")) {
      options.layout = "dagre";
    } else if (key === "sketch") {
      options.sketch = parseBoolean(rawValue || undefined);
    } else if (key === "center") {
      options.center = parseBoolean(rawValue || undefined);
    } else if (key === "theme" || key === "themeID") {
      options.themeID = parseNumber(rawValue);
    } else if (key === "darkTheme" || key === "darkThemeID") {
      options.darkThemeID = parseNumber(rawValue);
    } else if (key === "pad") {
      options.pad = parseNumber(rawValue);
    } else if (key === "scale") {
      options.scale = parseNumber(rawValue);
    }
  }

  return options;
}

function renderD2(code: string, meta: string | null | undefined): string {
  const salt = hash(`${meta ?? ""}\n${code}`);
  const options: D2Meta = {
    themeID: 4,
    pad: 48,
    ...parseMeta(meta),
  };

  const result = spawnSync(process.execPath, [rendererPath], {
    encoding: "utf8",
    input: JSON.stringify({ code, options, salt }),
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "Unknown D2 error")
      .trim()
      .split("\n")[0];
    throw new Error(`D2 render failed: ${message}`);
  }

  const parsed = JSON.parse(result.stdout) as { svg: string };
  return `<figure class="diagram-frame diagram-frame--d2" data-diagram-kind="d2" data-diagram-id="${escapeAttribute(
    salt
  )}"><div class="d2 diagram-canvas">${parsed.svg}</div></figure>`;
}

/**
 * ```d2 코드 블록을 빌드타임 SVG로 렌더링한다.
 *
 * D2의 JS wrapper는 내부 worker를 사용하므로 Astro 프로세스에서 직접 import하지
 * 않고, 별도 Node process에서 렌더링해 빌드 hang 가능성을 차단한다.
 */
export function remarkD2() {
  return (tree: any) => {
    visit(tree, "code", (node: any, index: any, parent: any) => {
      if (node.lang !== "d2" || !parent || typeof index !== "number") return;
      parent.children[index] = {
        type: "html",
        value: renderD2(String(node.value), node.meta),
      };
    });
  };
}
