import fs from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";
import { slugifyStr } from "./slugify";

const POSTS_DIR = "src/content/posts";
const MARKDOWN_EXT_RE = /\.mdx?$/i;

function walkMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(abs));
    } else if (MARKDOWN_EXT_RE.test(entry.name)) {
      files.push(path.resolve(abs));
    }
  }
  return files;
}

function toPostUrl(filePath: string): string {
  const relative = path
    .relative(path.resolve(POSTS_DIR), filePath)
    .replace(/\\/g, "/")
    .replace(MARKDOWN_EXT_RE, "");
  const segments = relative.split("/").filter(Boolean);
  const slugPath = segments
    .map((segment, index) =>
      index === segments.length - 1 ? segment : slugifyStr(segment)
    )
    .join("/");

  return `/posts/${slugPath}/`;
}

function buildPostUrlMap(): Map<string, string> {
  return new Map(
    walkMarkdownFiles(POSTS_DIR).map(filePath => [
      filePath,
      toPostUrl(filePath),
    ])
  );
}

function splitHash(url: string): [string, string] {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return [url, ""];
  return [url.slice(0, hashIndex), url.slice(hashIndex)];
}

function isRelativeMarkdownLink(url: string): boolean {
  if (
    url.startsWith("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(url) ||
    url.startsWith("/")
  ) {
    return false;
  }

  const [withoutHash] = splitHash(url);
  return MARKDOWN_EXT_RE.test(withoutHash.split("?")[0] ?? "");
}

/**
 * Rewrites relative links to markdown source files into their public post URLs.
 *
 * Markdown links such as `[next](./next-post.md)` otherwise render as browser
 * relative URLs like `/posts/current/next-post.md`, which 404 on the static site.
 */
export function remarkContentLinks() {
  const postUrlByFile = buildPostUrlMap();

  return (tree: any, file: any) => {
    const currentPath =
      typeof file?.path === "string" ? path.resolve(file.path) : "";
    const currentDir = currentPath ? path.dirname(currentPath) : "";

    if (!currentDir) return;

    visit(tree, ["link", "definition"], (node: any) => {
      if (typeof node.url !== "string" || !isRelativeMarkdownLink(node.url)) {
        return;
      }

      const [withoutHash, hash] = splitHash(node.url);
      const [pathname] = withoutHash.split("?");
      const decodedPathname = decodeURIComponent(pathname ?? "");
      const targetPath = path.resolve(currentDir, decodedPathname);
      const postUrl = postUrlByFile.get(targetPath);

      if (postUrl) {
        node.url = `${postUrl}${hash}`;
      }
    });
  };
}
