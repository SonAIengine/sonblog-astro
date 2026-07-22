import type { APIRoute } from "astro";

const getRobotsTxt = (sitemapURL: URL) => `
User-agent: *
Allow: /

User-agent: BubblesBot
Allow: /

Sitemap: ${sitemapURL.href}
`;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL(
    "sitemap.xml",
    site ?? new URL("https://infoedu.co.kr/")
  );
  return new Response(getRobotsTxt(sitemapURL));
};
