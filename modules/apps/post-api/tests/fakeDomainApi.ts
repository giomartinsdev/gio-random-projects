import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { DomainPost } from "../src/lib/domainApiClient.js";

// A real HTTP server standing in for domain-api's contract (GET/POST/
// PUT/DELETE /posts, X-API-Key auth) -- not the actual Go binary
// (would need its own Postgres/Redis/domain-worker triple to exercise
// for real), but a genuine network hop, not an in-process mock of
// post-api's client functions. Applies writes synchronously (the
// real domain-worker is async) since what's under test here is
// post-api's own auth/ownership logic, not eventual consistency.
export function startFakeDomainApi(apiKey: string) {
  const posts = new Map<string, DomainPost>();
  let slugCounter = 0;

  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.header("x-api-key") !== apiKey) {
      return c.json({ error: "missing or invalid API key" }, 401);
    }
    await next();
  });

  app.get("/posts", (c) => {
    const published = [...posts.values()].filter((p) => p.status === "published");
    return c.json({ posts: published });
  });

  app.post("/posts", async (c) => {
    const body = await c.req.json();
    if (!body.author_id || !body.title || !body.body_markdown) {
      return c.json({ error: "author_id, title and body_markdown are required" }, 400);
    }
    const id = crypto.randomUUID();
    slugCounter += 1;
    const slug = `${body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${slugCounter}`;
    const now = new Date().toISOString();
    const status = body.status ?? "draft";
    const post: DomainPost = {
      id,
      author_id: body.author_id,
      title: body.title,
      slug,
      body_markdown: body.body_markdown,
      excerpt: body.excerpt ?? "",
      cover_image_url: body.cover_image_url ?? "",
      type: body.type ?? "article",
      status,
      source: "native",
      source_url: "",
      created_at: now,
      updated_at: now,
      published_at: status === "published" ? now : null,
    };
    posts.set(id, post);
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  app.get("/posts/slug/:slug", (c) => {
    const post = [...posts.values()].find((p) => p.slug === c.req.param("slug") && p.status === "published");
    if (!post) return c.json({ error: "not found" }, 404);
    return c.json(post);
  });

  app.get("/posts/id/:id", (c) => {
    const post = posts.get(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    return c.json(post);
  });

  app.put("/posts/:id", async (c) => {
    const post = posts.get(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    Object.assign(post, {
      title: body.title || post.title,
      body_markdown: body.body_markdown || post.body_markdown,
      excerpt: body.excerpt || post.excerpt,
      cover_image_url: body.cover_image_url || post.cover_image_url,
      status: body.status || post.status,
      updated_at: new Date().toISOString(),
    });
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  app.delete("/posts/:id", (c) => {
    const post = posts.get(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    posts.delete(c.req.param("id"));
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  const server = serve({ fetch: app.fetch, port: 0 });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
