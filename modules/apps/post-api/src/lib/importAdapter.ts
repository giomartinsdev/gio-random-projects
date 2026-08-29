import * as cheerio from "cheerio";
import TurndownService from "turndown";

// Turns a public dev.to / TabNews / Medium link into a draft-ready
// markdown article. This deliberately lives in post-api and NOT at the
// front: the fetch is server-side by nature (dev.to's API disallows
// CORS, and Medium's HTML is useless from a browser), and the SSRF
// surface it opens is bounded by per-provider host allowlists below --
// an internal hostname can never look like dev.to/tabnews.com.br/medium.com.
//
// The import endpoint itself does not create the post: it returns the
// fetched draft so the author reviews/edits it in the normal create
// form and publishes through the usual CQRS path. Attribution is baked
// into the returned markdown body as the required "retirado daqui"
// footer line -- the CQRS pipeline (domain-api/worker) has no
// source/source_url fields in its CreateInput, so the columns on the
// read model cannot be populated without Go-side changes.

export type ImportProvider = "dev.to" | "tabnews" | "medium";

export type ImportedArticle = {
  provider: ImportProvider;
  title: string;
  // Attribution footer already appended -- see attributionBlock.
  bodyMarkdown: string;
  excerpt?: string;
  coverImageUrl?: string;
  originalUrl: string;
};

export class UnsupportedImportUrlError extends Error {}
// The source exists but the fetch or extraction failed on their side.
export class ImportUpstreamError extends Error {}
// Fetched article exceeds what POST /posts would accept for a body.
export class ImportTooLargeError extends Error {}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 10 * 1024 * 1024;
// Mirrors posts.ts BODY_MAX -- the output of an import must be
// submittable through the normal create route, so reject upstream here.
const MAX_BODY_CHARS = 500_000;
const MAX_REDIRECTS = 5;

const PROVIDER_LABEL: Record<ImportProvider, string> = {
  "dev.to": "dev.to",
  tabnews: "TabNews",
  medium: "Medium",
};

// The required provenance footer, e.g.:
//   *Retirado daqui do dev.to por [@user](https://dev.to/user) -- [link original](https://dev.to/user/slug).*
function attributionBlock(opts: { provider: ImportProvider; originalUrl: string; handle?: string; profileUrl?: string }): string {
  const via = opts.handle
    ? opts.profileUrl
      ? ` por [@${opts.handle}](${opts.profileUrl})`
      : ` por @${opts.handle}`
    : "";
  return `\n\n---\n\n*Retirado daqui do ${PROVIDER_LABEL[opts.provider]}${via} — [link original](${opts.originalUrl}).*`;
}

function finalize(
  provider: ImportProvider,
  originalUrl: string,
  article: { title: string; excerpt?: string; coverImageUrl?: string },
  attribution: { handle?: string; profileUrl?: string },
  markdown: string,
): ImportedArticle {
  if (!markdown.trim()) throw new ImportUpstreamError("could not extract the article text");
  const bodyMarkdown = markdown.trim() + attributionBlock({ provider, originalUrl, ...attribution });
  if (bodyMarkdown.length > MAX_BODY_CHARS) {
    throw new ImportTooLargeError("imported article is too large to import (body limit is 500000 characters)");
  }
  return { provider, originalUrl, bodyMarkdown, ...article };
}

// JSON over HTTP with a hard timeout; the fixed API endpoints here are
// provider-hosted and derived from parsed URL segments (never passed
// through verbatim), so no per-hop host checks are needed.
async function fetchJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new ImportUpstreamError("failed to fetch the source article");
  }
  if (!res.ok) throw new ImportUpstreamError(`upstream returned ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ImportUpstreamError("upstream response was not JSON");
  }
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function isMediumHost(hostname: string): boolean {
  const host = stripWww(hostname);
  return host === "medium.com" || host.endsWith(".medium.com");
}

// Medium has no usable write-side API, so this scrapes the SSR'd
// article HTML. Redirects are followed but every hop must stay on a
// medium.com host (the mirror of imageProxy.ts's per-hop revalidation),
// and plain JSON here would be a lie about the size of the HTML that
// actually comes back -- capped at 10 MB before parsing.
async function fetchMediumHtml(start: URL, fetchFn: typeof fetch): Promise<string> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchFn(current.toString(), { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new ImportUpstreamError("failed to fetch the source article");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new ImportUpstreamError(`upstream returned ${res.status}`);
      current = new URL(location, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") throw new ImportUpstreamError("redirected to a non-http(s) url");
      if (!isMediumHost(current.hostname)) throw new ImportUpstreamError("redirected away from medium.com");
      continue;
    }
    if (!res.ok) throw new ImportUpstreamError(`upstream returned ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html")) throw new ImportUpstreamError("medium page did not return html");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_HTML_BYTES) throw new ImportTooLargeError("medium page is too large to import");
    return bytes.toString("utf8");
  }
  throw new ImportUpstreamError("too many redirects");
}

function firstContentLine(text: string, max = 300): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line) return undefined;
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

async function importDevTo(url: URL, fetchFn: typeof fetch): Promise<ImportedArticle> {
  // Articles live at dev.to/<user>/<slug-with-random-suffix>; the
  // public API is the same shape prefixed with /api/articles.
  const segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  if (segments.length < 2) throw new UnsupportedImportUrlError("dev.to link must look like dev.to/<user>/<slug>");
  const [user, slug] = segments;

  const api = `https://dev.to/api/articles/${encodeURIComponent(user)}/${encodeURIComponent(slug)}`;
  const article = await fetchJson<{
    title?: string;
    description?: string;
    body_markdown?: string;
    cover_image?: string | null;
    user?: { username?: string } | null;
  }>(api, fetchFn);

  if (!article.title || !article.body_markdown) throw new ImportUpstreamError("dev.to article is missing title or body");

  return finalize(
    "dev.to",
    url.href,
    {
      title: article.title,
      excerpt: article.description || undefined,
      coverImageUrl: article.cover_image || undefined,
    },
    {
      handle: article.user?.username ?? user,
      profileUrl: `https://dev.to/${encodeURIComponent(user)}`,
    },
    article.body_markdown,
  );
}

async function importTabNews(url: URL, fetchFn: typeof fetch): Promise<ImportedArticle> {
  // TabNews serves its markdown verbatim on
  // /api/v1/contents/<user>/<slug> -- the same path shape as the page
  // itself, so the content never needs an HTML scrape.
  const segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  if (segments.length < 2) throw new UnsupportedImportUrlError("tabnews link must look like tabnews.com.br/<user>/<slug>");
  const [user, slug] = segments;

  const api = `https://www.tabnews.com.br/api/v1/contents/${encodeURIComponent(user)}/${encodeURIComponent(slug)}`;
  const content = await fetchJson<{ title?: string; body?: string; owner_username?: string }>(api, fetchFn);

  if (!content.title || !content.body) throw new ImportUpstreamError("tabnews content is missing title or body");

  return finalize(
    "tabnews",
    url.href,
    { title: content.title, excerpt: firstContentLine(content.body) },
    {
      handle: content.owner_username ?? user,
      profileUrl: `https://www.tabnews.com.br/${encodeURIComponent(user)}`,
    },
    content.body,
  );
}

async function importMedium(url: URL, fetchFn: typeof fetch): Promise<ImportedArticle> {
  const html = await fetchMediumHtml(url, fetchFn);
  const $ = cheerio.load(html);

  const articleEl = $("article").first().length ? $("article").first() : $("main").first();
  if (!articleEl.length) throw new ImportUpstreamError("could not find article content in the medium page");

  const title = articleEl.find("h1").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || "";
  if (!title) throw new ImportUpstreamError("could not find a title in the medium page");
  // Medium repeats the title as the body's own h1; keep it in the
  // title field only, or the imported body would open with a
  // duplicate heading.
  const leadHeading = articleEl.find("h1").first();
  if (leadHeading.text().trim() === title) leadHeading.remove();
  articleEl.find("script, style, noscript, button, footer").remove();

  const coverImageUrl = $('meta[property="og:image"]').attr("content") || undefined;

  // @handle in the path (medium.com/@user/...) or the post's own
  // subdomain (user.medium.com/...) -- enough of an identity for the
  // footer line, never a guarantee of authorship.
  const handle = url.pathname.startsWith("/@") ? decodeURIComponent(url.pathname.slice(2).split("/")[0]) : stripWww(url.hostname).replace(/\.medium\.com$/, "");
  const profileUrl = handle ? `https://medium.com/@${encodeURIComponent(handle)}` : undefined;

  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  const markdown = turndown.turndown((articleEl.html() ?? "").trim());

  return finalize(
    "medium",
    url.href,
    { title, excerpt: firstContentLine(markdown), coverImageUrl },
    { handle: handle || undefined, profileUrl },
    markdown,
  );
}

// Dispatch by hostname. Everything behind it is per-provider; the
// throw here is the only place an arbitrary URL gets rejected
// unsupported (400), not failed upstream (502).
export async function importFromUrl(rawUrl: string, fetchFn: typeof fetch = fetch): Promise<ImportedArticle> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsupportedImportUrlError("invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsupportedImportUrlError("only http(s) urls are supported");
  }

  const host = stripWww(parsed.hostname);
  if (host === "dev.to") return importDevTo(parsed, fetchFn);
  if (host === "tabnews.com.br") return importTabNews(parsed, fetchFn);
  if (isMediumHost(parsed.hostname)) return importMedium(parsed, fetchFn);
  throw new UnsupportedImportUrlError("only medium.com, dev.to and tabnews links are supported");
}