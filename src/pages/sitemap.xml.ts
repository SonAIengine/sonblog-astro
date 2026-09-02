import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostSortDatetime } from "@/utils/postDatetime";

const SITE_STRUCTURE_LASTMOD = "2026-09-01T15:00:00.000Z";

function latestISODate(...values: (string | undefined)[]) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

async function latestContentLastmod() {
  const posts = getSortedPosts(await getCollection("posts"));
  const latestPost = posts[0];
  return latestISODate(
    SITE_STRUCTURE_LASTMOD,
    latestPost ? getPostSortDatetime(latestPost).toISOString() : undefined
  );
}

function sitemapIndexXml(site: URL, lastmod?: string) {
  const sitemapURL = new URL("sitemap-0.xml", site);

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${sitemapURL.href}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}
  </sitemap>
</sitemapindex>
`;
}

export const GET: APIRoute = async ({ site }) =>
  new Response(
    sitemapIndexXml(
      site ?? new URL("https://infoedu.co.kr/"),
      await latestContentLastmod()
    ),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
      },
    }
  );
