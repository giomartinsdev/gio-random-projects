import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import { posts, postsToTags, tags } from "../db/schema.js";
import { slugify } from "../lib/slug.js";
import type { Auth } from "../lib/auth.js";

type Variables = {
  userId: string;
};

async function requireAuth(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  // Small, bounded loop -- collisions on a single title are rare, and
  // each iteration is one indexed lookup.
  while (true) {
    const existing = await db.query.posts.findFirst({ where: eq(posts.slug, candidate) });
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

async function attachTags(db: Db, postId: string, tagNames: string[]) {
  if (tagNames.length === 0) return;
  const tagIds: string[] = [];
  for (const name of tagNames) {
    const existing = await db.query.tags.findFirst({ where: eq(tags.name, name) });
    if (existing) {
      tagIds.push(existing.id);
    } else {
      const [created] = await db.insert(tags).values({ name }).returning({ id: tags.id });
      tagIds.push(created.id);
    }
  }
  await db.insert(postsToTags).values(tagIds.map((tagId) => ({ postId, tagId })));
}

async function tagsForPost(db: Db, postId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(postsToTags)
    .innerJoin(tags, eq(postsToTags.tagId, tags.id))
    .where(eq(postsToTags.postId, postId));
  return rows.map((r) => r.name);
}

function serializePost(post: typeof posts.$inferSelect, tagNames: string[]) {
  return {
    id: post.id,
    authorId: post.authorId,
    title: post.title,
    slug: post.slug,
    bodyMarkdown: post.bodyMarkdown,
    excerpt: post.excerpt,
    coverImageUrl: post.coverImageUrl,
    type: post.type,
    status: post.status,
    source: post.source,
    sourceUrl: post.sourceUrl,
    tags: tagNames,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
  };
}

export function createPostsRouter(db: Db, auth: Auth) {
  const router = new Hono<{ Variables: Variables }>();

  router.get("/", async (c) => {
    const rows = await db.query.posts.findMany({ where: eq(posts.status, "published") });
    const serialized = await Promise.all(
      rows.map(async (p) => serializePost(p, await tagsForPost(db, p.id))),
    );
    return c.json({ posts: serialized });
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
      tags?: string[];
    }>();

    if (!body.title || !body.bodyMarkdown) {
      return c.json({ error: "title and bodyMarkdown are required" }, 400);
    }

    const slug = await uniqueSlug(db, slugify(body.title));
    const status = body.status ?? "draft";

    const [created] = await db
      .insert(posts)
      .values({
        authorId: userId,
        title: body.title,
        slug,
        bodyMarkdown: body.bodyMarkdown,
        excerpt: body.excerpt,
        coverImageUrl: body.coverImageUrl,
        type: body.type ?? "article",
        status,
        publishedAt: status === "published" ? new Date() : null,
      })
      .returning();

    const tagNames = body.tags ?? [];
    await attachTags(db, created.id, tagNames);

    return c.json(serializePost(created, tagNames), 201);
  });

  router.get("/:slug", async (c) => {
    const post = await db.query.posts.findFirst({
      where: and(eq(posts.slug, c.req.param("slug")), eq(posts.status, "published")),
    });
    if (!post) return c.json({ error: "not found" }, 404);
    return c.json(serializePost(post, await tagsForPost(db, post.id)));
  });

  router.patch("/:id", async (c) => {
    const userId = await requireAuth(auth, c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const existing = await db.query.posts.findFirst({ where: eq(posts.id, c.req.param("id")) });
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.authorId !== userId) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      title?: string;
      bodyMarkdown?: string;
      excerpt?: string;
      coverImageUrl?: string;
      status?: "draft" | "published";
      tags?: string[];
    }>();

    const nextStatus = body.status ?? existing.status;
    const [updated] = await db
      .update(posts)
      .set({
        title: body.title ?? existing.title,
        bodyMarkdown: body.bodyMarkdown ?? existing.bodyMarkdown,
        excerpt: body.excerpt ?? existing.excerpt,
        coverImageUrl: body.coverImageUrl ?? existing.coverImageUrl,
        status: nextStatus,
        publishedAt:
          nextStatus === "published" ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, existing.id))
      .returning();

    if (body.tags) {
      await db.delete(postsToTags).where(eq(postsToTags.postId, existing.id));
      await attachTags(db, existing.id, body.tags);
    }

    return c.json(serializePost(updated, await tagsForPost(db, existing.id)));
  });

  router.delete("/:id", async (c) => {
    const userId = await requireAuth(auth, c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const existing = await db.query.posts.findFirst({ where: eq(posts.id, c.req.param("id")) });
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.authorId !== userId) return c.json({ error: "forbidden" }, 403);

    await db.delete(posts).where(eq(posts.id, existing.id));
    return c.body(null, 204);
  });

  return router;
}
