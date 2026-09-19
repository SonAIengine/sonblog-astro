import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const POSTS_DIR = path.join(ROOT, "src/content/posts");
const DIST_DIR = path.join(ROOT, "dist");
const INDEX_FILE = path.join(DIST_DIR, "search-index.json");
const SOCIAL_DIR = path.join(DIST_DIR, "assets/images/social");
const FONT_FILE =
  process.env.SONBLOG_OG_FONT_FILE ??
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
const LEGACY_FEEDS = ["feed_rss_created.xml", "feed_rss_updated.xml"];
const WIDTH = 1200;
const HEIGHT = 630;

const TOPIC_LABELS = {
  ai: "AI / AGENTS",
  devops: "DEVOPS / INFRA",
  "full-stack": "FULL STACK",
  portfolio: "PORTFOLIO",
  "search-engine": "SEARCH ENGINE",
};

function escapeMarkup(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeSegments(value) {
  const segments = value.split("/");
  if (!segments.every(segment => /^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error(`Invalid post path: ${value}`);
  }
  return segments;
}

export function imagePathForPostUrl(url) {
  const parsed = new URL(url, "https://infoedu.co.kr");
  if (parsed.origin !== "https://infoedu.co.kr") {
    throw new Error(`Invalid post URL origin: ${url}`);
  }
  const pathname = parsed.pathname;
  const match = pathname.match(/^\/posts\/(.+)\/$/);
  if (!match) throw new Error(`Invalid post URL: ${url}`);
  return `${safeSegments(match[1]).join("/")}.png`;
}

export function imagePathForSourceFile(file) {
  const relative = path.relative(POSTS_DIR, file).replaceAll(path.sep, "/");
  const withoutExtension = relative.replace(/\.(md|mdx)$/, "");
  if (withoutExtension === relative) throw new Error(`Invalid post file: ${file}`);
  return `${safeSegments(withoutExtension).join("/")}.png`;
}

async function walkPosts(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkPosts(file)));
    else if (/\.(md|mdx)$/.test(entry.name)) files.push(file);
  }
  return files;
}

function backgroundSvg(category) {
  const label = escapeMarkup(TOPIC_LABELS[category] ?? "TECH NOTES");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7fafb"/>
  <rect width="14" height="${HEIGHT}" fill="#087b75"/>
  <rect x="80" y="142" width="1040" height="3" fill="#e36b52"/>
  <text x="80" y="107" fill="#18252d" font-family="DejaVu Sans" font-size="43" font-weight="bold">SON BLOG</text>
  <text x="1120" y="101" fill="#087b75" font-family="DejaVu Sans" font-size="22" text-anchor="end">${label}</text>
  <text x="80" y="574" fill="#5c6c73" font-family="DejaVu Sans" font-size="24">infoedu.co.kr</text>
  <rect x="80" y="542" width="1040" height="1" fill="#d8e2e5"/>
</svg>`);
}

async function renderSocialImage(post) {
  const title = escapeMarkup(post.title);
  let titleImage;
  let titleHeight;
  for (let fontSize = 50; fontSize >= 28; fontSize -= 2) {
    titleImage = await sharp({
      text: {
        text: `<span foreground="#18252d">${title}</span>`,
        font: `Noto Sans CJK KR Bold ${fontSize}`,
        fontfile: FONT_FILE,
        width: 1040,
        wrap: "word-char",
        rgba: true,
      },
    })
      .png()
      .toBuffer();
    titleHeight = (await sharp(titleImage).metadata()).height;
    if (titleHeight <= 330) break;
  }
  if (!titleImage || !titleHeight || titleHeight > 330) {
    throw new Error(`Social image title does not fit: ${post.url}`);
  }

  return sharp(backgroundSvg(post.category))
    .composite([
      { input: titleImage, left: 80, top: 175 + Math.floor((330 - titleHeight) / 2) },
    ])
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
}

async function restoreLegacyAssets() {
  await fs.access(FONT_FILE);
  const posts = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
  const sourceFiles = await walkPosts(POSTS_DIR);
  const sourceByRoute = new Map(
    sourceFiles.map(file => {
      const imagePath = imagePathForSourceFile(file);
      return [imagePath.toLowerCase(), imagePath];
    })
  );

  let imageCount = 0;
  for (const post of posts) {
    const routePath = imagePathForPostUrl(post.url);
    const paths = new Set([routePath]);
    const sourcePath = sourceByRoute.get(routePath.toLowerCase());
    if (sourcePath) paths.add(sourcePath);
    const image = await renderSocialImage(post);

    for (const relative of paths) {
      const destination = path.join(SOCIAL_DIR, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, image);
      imageCount++;
    }
  }

  for (const feed of LEGACY_FEEDS) {
    await fs.copyFile(path.join(DIST_DIR, "rss.xml"), path.join(DIST_DIR, feed));
  }
  console.log(
    `Restored ${imageCount} social image URLs for ${posts.length} posts and ${LEGACY_FEEDS.length} legacy feeds.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await restoreLegacyAssets();
}
