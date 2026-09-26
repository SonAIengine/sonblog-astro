import type { APIRoute } from "astro";
const sitemapBuildLastmod = new Date().toISOString();

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

export const GET: APIRoute = ({ site }) =>
  new Response(
    sitemapIndexXml(
      site ?? new URL("https://infoedu.co.kr/"),
      sitemapBuildLastmod
    ),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
      },
    }
  );
