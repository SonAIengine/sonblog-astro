import type { APIRoute } from "astro";

const getRobotsTxt = (site: URL) => {
  const sitemapIndexURL = new URL("sitemap.xml", site);
  const sitemapURL = new URL("sitemap-0.xml", site);
  const rssURL = new URL("rss.xml", site);

  return `
User-agent: *
Allow: /

User-agent: BubblesBot
Allow: /

Sitemap: ${sitemapIndexURL.href}
Sitemap: ${sitemapURL.href}
Sitemap: ${rssURL.href}
`;
};

export const GET: APIRoute = ({ site }) => {
  const siteURL = site ?? new URL("https://infoedu.co.kr/");
  return new Response(getRobotsTxt(siteURL), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
