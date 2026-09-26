import type { APIRoute } from "astro";

const getRobotsTxt = (site: URL) => {
  const sitemapIndexURL = new URL("sitemap.xml", site);

  return `
User-agent: *
Allow: /

User-agent: BubblesBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

Sitemap: ${sitemapIndexURL.href}
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
