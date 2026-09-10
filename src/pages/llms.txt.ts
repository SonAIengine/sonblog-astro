import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { topics } from "@/data/topics";
import { getPostUrl } from "@/utils/getPostPaths";
import { getSortedPosts } from "@/utils/getSortedPosts";
import config from "@/config";

function absoluteURL(pathname: string, site: URL) {
  return new URL(pathname, site).href;
}

export const GET: APIRoute = async ({ site }) => {
  const siteURL = site ?? new URL(config.site.url);
  const posts = getSortedPosts(await getCollection("posts"));
  const postsById = new Map(posts.map(post => [post.id.toLowerCase(), post]));
  const selectedPosts = topics
    .flatMap(topic => topic.featuredIds)
    .map(id => postsById.get(id.toLowerCase()))
    .filter(post => post !== undefined)
    .filter(
      (post, index, all) => all.findIndex(item => item.id === post.id) === index
    );

  const topicLinks = topics.map(
    topic =>
      `- [${topic.title}](${absoluteURL(`/topics/${topic.slug}/`, siteURL)}): ${topic.description}`
  );
  const selectedLinks = selectedPosts.map(
    post =>
      `- [${post.data.title}](${absoluteURL(getPostUrl(post.id, post.filePath), siteURL)}): ${post.data.description}`
  );
  const recentLinks = posts
    .slice(0, 12)
    .map(
      post =>
        `- [${post.data.title}](${absoluteURL(getPostUrl(post.id, post.filePath), siteURL)}): ${post.data.description}`
    );

  const body = [
    `# ${config.site.title}`,
    "",
    `> ${config.site.description}`,
    "",
    "SON BLOG is a Korean-language engineering blog by AI Engineer Son Sungjun. It documents first-hand implementation, troubleshooting, architecture, and operations experience in search engines, AI agents, LLM serving, full-stack development, and DevOps.",
    "",
    "## Author and site",
    "",
    `- [About the author](${absoluteURL("/about/", siteURL)})`,
    `- [Engineering portfolio](${absoluteURL("/portfolio/", siteURL)})`,
    `- [All posts](${absoluteURL("/posts/", siteURL)})`,
    `- [Search](${absoluteURL("/search/", siteURL)})`,
    "",
    "## Topic guides",
    "",
    ...topicLinks,
    "",
    "## Selected articles",
    "",
    ...selectedLinks,
    "",
    "## Recently updated",
    "",
    ...recentLinks,
    "",
    "## Machine-readable indexes",
    "",
    `- [Complete article catalog](${absoluteURL("/llms-full.txt", siteURL)})`,
    `- [XML sitemap](${absoluteURL("/sitemap.xml", siteURL)})`,
    `- [RSS feed](${absoluteURL("/rss.xml", siteURL)})`,
    `- [Search index](${absoluteURL("/search-index.json", siteURL)})`,
    "",
    "Canonical origin: https://infoedu.co.kr/",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
