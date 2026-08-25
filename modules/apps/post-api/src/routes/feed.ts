import { Hono } from "hono";
import type { DomainApiClient, DomainPost } from "../lib/domainApiClient.js";

const MAX_ITEMS = 50;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// bodyMarkdown ships raw in the API response elsewhere (front renders
// it) -- an RSS <description> needs plain-ish text, not markdown
// syntax, so this strips the handful of markdown constructs actually
// used on this blog rather than pulling in a full markdown-to-text
// dependency for a feed excerpt nobody reads past the first
// paragraph anyway.
function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemXml(p: DomainPost, siteUrl: string): string {
  const url = `${siteUrl}/posts/${encodeURIComponent(p.slug)}`;
  const description = xmlEscape((p.excerpt || markdownToPlainText(p.body_markdown)).slice(0, 500));
  const pubDate = new Date(p.published_at ?? p.created_at).toUTCString();
  return `  <item>
    <title>${xmlEscape(p.title)}</title>
    <link>${xmlEscape(url)}</link>
    <guid isPermaLink="true">${xmlEscape(url)}</guid>
    <description>${description}</description>
    <pubDate>${pubDate}</pubDate>
  </item>`;
}

// Public, no auth -- feed readers/aggregators are anonymous clients
// by nature, same reasoning as GET /posts itself being unauthenticated.
export function createFeedRouter(domainApi: DomainApiClient, siteUrl: string) {
  const router = new Hono();

  router.get("/feed.xml", async (c) => {
    const { posts } = await domainApi.listPublished();
    const items = posts
      .filter((p) => p.published_at)
      .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())
      .slice(0, MAX_ITEMS)
      .map((p) => itemXml(p, siteUrl))
      .join("\n");

    const lastBuildDate = new Date().toUTCString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Sala de aula do Buteco</title>
  <link>${xmlEscape(siteUrl)}</link>
  <description>Artigos e cursos da Sala de aula do Buteco</description>
  <language>pt-BR</language>
  <lastBuildDate>${lastBuildDate}</lastBuildDate>
  <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${xmlEscape(siteUrl)}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
    return c.text(xml, 200, { "content-type": "application/rss+xml; charset=utf-8" });
  });

  return router;
}
