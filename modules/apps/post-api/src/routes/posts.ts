import { Hono } from "hono";
import type { Auth } from "../lib/auth.js";
import { DomainApiError, NotFoundError, type DomainApiClient, type DomainPost } from "../lib/domainApiClient.js";

async function requireAuth(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

const TITLE_MAX = 300;
const EXCERPT_MAX = 1000;
const BODY_MAX = 500_000;
const URL_MAX = 2048;

// domain-api/domain-worker persist whatever gets forwarded here with
// no length limit of their own (see this codebase's earlier UX audit
// of bookclub-api's PDF upload, which had a similar unbounded-input
// gap) -- these are generous enough to never bother a real
// article/course, just to stop an unbounded body from reaching
// Postgres via the command pipeline at all.
function checkContentLengths(body: {
  title?: string;
  bodyMarkdown?: string;
  excerpt?: string;
  coverImageUrl?: string;
}): string | null {
  if (body.title && body.title.length > TITLE_MAX) return `title must be under ${TITLE_MAX} characters`;
  if (body.bodyMarkdown && body.bodyMarkdown.length > BODY_MAX) return `bodyMarkdown must be under ${BODY_MAX} characters`;
  if (body.excerpt && body.excerpt.length > EXCERPT_MAX) return `excerpt must be under ${EXCERPT_MAX} characters`;
  if (body.coverImageUrl && body.coverImageUrl.length > URL_MAX) return `coverImageUrl must be under ${URL_MAX} characters`;
  return null;
}

function serialize(p: DomainPost) {
  return {
    id: p.id,
    authorId: p.author_id,
    title: p.title,
    slug: p.slug,
    bodyMarkdown: p.body_markdown,
    excerpt: p.excerpt,
    coverImageUrl: p.cover_image_url,
    type: p.type,
    status: p.status,
    source: p.source,
    sourceUrl: p.source_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    publishedAt: p.published_at,
  };
}

// Every write here returns 202 Accepted, not 200/201/204: post-api
// never touches Postgres for posts, it hands the request to domain-api
// which publishes a command applied asynchronously by domain-worker
// (see domain-api/domain-worker's own package docs for why). A GET
// immediately after a write may not reflect it yet -- that's the
// trade-off of reusing this repo's existing CQRS pipeline instead of
// post-api owning its own synchronous storage.
export function createPostsRouter(auth: Auth, domainApi: DomainApiClient) {
  const router = new Hono();

  router.get("/", async (c) => {
    const { posts } = await domainApi.listPublished();
    return c.json({ posts: posts.map(serialize) });
  });

  router.post("/", async (c) => {
    const userId = await requireAuth(auth, c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json<{
      title?: string;
      bodyMarkdown?: string;
      excerpt?: string;
      coverImageUrl?: string;
      type?: "article" | "course";
      status?: "draft" | "published";
    }>();

    if (!body.title || !body.bodyMarkdown) {
      return c.json({ error: "title and bodyMarkdown are required" }, 400);
    }
    const lengthError = checkContentLengths(body);
    if (lengthError) return c.json({ error: lengthError }, 400);

    try {
      const accepted = await domainApi.create({
        author_id: userId,
        title: body.title,
        body_markdown: body.bodyMarkdown,
        excerpt: body.excerpt,
        cover_image_url: body.coverImageUrl,
        type: body.type,
        status: body.status,
      });
      return c.json(accepted, 202);
    } catch (err) {
      if (err instanceof DomainApiError && err.status === 400) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  router.get("/:slug", async (c) => {
    try {
      const post = await domainApi.getBySlug(c.req.param("slug"));
      return c.json(serialize(post));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  router.patch("/:id", async (c) => {
    const userId = await requireAuth(auth, c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const existing = await lookupForOwnershipCheck(domainApi, c.req.param("id"));
    if (existing === "not-found") return c.json({ error: "not found" }, 404);
    if (existing.author_id !== userId) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      title?: string;
      bodyMarkdown?: string;
      excerpt?: string;
      coverImageUrl?: string;
      status?: "draft" | "published";
    }>();
    const lengthError = checkContentLengths(body);
    if (lengthError) return c.json({ error: lengthError }, 400);

    const accepted = await domainApi.update(existing.id, {
      author_id: userId,
      title: body.title,
      body_markdown: body.bodyMarkdown,
      excerpt: body.excerpt,
      cover_image_url: body.coverImageUrl,
      status: body.status,
    });
    return c.json(accepted, 202);
  });

  router.delete("/:id", async (c) => {
    const userId = await requireAuth(auth, c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const existing = await lookupForOwnershipCheck(domainApi, c.req.param("id"));
    if (existing === "not-found") return c.json({ error: "not found" }, 404);
    if (existing.author_id !== userId) return c.json({ error: "forbidden" }, 403);

    const accepted = await domainApi.remove(existing.id, userId);
    return c.json(accepted, 202);
  });

  return router;
}

async function lookupForOwnershipCheck(domainApi: DomainApiClient, id: string): Promise<DomainPost | "not-found"> {
  try {
    return await domainApi.getById(id);
  } catch (err) {
    if (err instanceof NotFoundError) return "not-found";
    throw err;
  }
}
