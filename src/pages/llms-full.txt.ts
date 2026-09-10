import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getPostUrl } from "@/utils/getPostPaths";
import { getSortedPosts } from "@/utils/getSortedPosts";
import {
  formatDateInSiteTimeZone,
  getPostSortDatetime,
} from "@/utils/postDatetime";
import config from "@/config";

function categoryFromPath(filePath?: string) {
  const relativePath = filePath?.split(/posts[\\/]/).pop() ?? "";
  return relativePath.split(/[\\/]/)[0] || "other";
}

export const GET: APIRoute = async ({ site }) => {
  const siteURL = site ?? new URL(config.site.url);
  const posts = getSortedPosts(await getCollection("posts"));
  const groups = posts.reduce((result, post) => {
    const category = categoryFromPath(post.filePath);
    const entries = result.get(category) ?? [];
    entries.push(post);
    result.set(category, entries);
    return result;
  }, new Map<string, typeof posts>());
  const sections = [...groups.entries()].flatMap(([category, entries]) => [
    `## ${category}`,
    "",
    ...entries.flatMap(post => [
      `### [${post.data.title}](${new URL(getPostUrl(post.id, post.filePath), siteURL).href})`,
      "",
      `- Updated: ${formatDateInSiteTimeZone(getPostSortDatetime(post))}`,
      `- Tags: ${post.data.tags.join(", ")}`,
      `- Summary: ${post.data.description}`,
      "",
    ]),
  ]);

  const body = [
    `# ${config.site.title}: complete article catalog`,
    "",
    `> ${config.site.description}`,
    "",
    "This catalog lists every public, canonical article. Follow each article link for the complete text, code, diagrams, and references.",
    "",
    ...sections,
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
