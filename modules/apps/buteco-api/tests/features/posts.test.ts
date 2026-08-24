import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/app.js";
import { createAuth, type Auth } from "../../src/lib/auth.js";
import type { Db } from "../../src/db/index.js";
import { startTestDb } from "../testDb.js";

let stopDb: () => Promise<void>;
let db: Db;
let auth: Auth;
let app: App;

async function signUp(email: string, name = "Test Dev") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", name }),
  });
  expect(res.status).toBe(200);
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return { authHeader: `Bearer ${token}` };
}

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stopDb = started.stop;
  auth = createAuth(db, "test-secret-do-not-use-in-production-min-32-chars");
  app = createApp(db, auth);
}, 60_000);

afterAll(async () => {
  await stopDb();
});

describe("POST /posts", () => {
  it("creates a post for an authenticated user (positive)", async () => {
    const { authHeader } = await signUp("author-create@example.com");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({
        title: "Como escalar Terraform sem chorar",
        bodyMarkdown: "# Intro\n\nConteúdo aqui.",
        type: "article",
        tags: ["terraform", "iac"],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Como escalar Terraform sem chorar");
    expect(body.slug).toBe("como-escalar-terraform-sem-chorar");
    expect(body.status).toBe("draft");
    expect(body.tags.sort()).toEqual(["iac", "terraform"]);
  });

  it("rejects an unauthenticated request (negative)", async () => {
    const res = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x", bodyMarkdown: "y" }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects a post with no title (negative)", async () => {
    const { authHeader } = await signUp("author-notitle@example.com");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ bodyMarkdown: "no title here" }),
    });

    expect(res.status).toBe(400);
  });

  it("de-duplicates the slug when titles collide (edge)", async () => {
    const { authHeader } = await signUp("author-dupe@example.com");
    const payload = {
      title: "Post Duplicado",
      bodyMarkdown: "primeiro",
      type: "article",
    };

    const first = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify(payload),
    });
    const second = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ ...payload, bodyMarkdown: "segundo" }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.slug).toBe("post-duplicado");
    expect(secondBody.slug).toBe("post-duplicado-2");
  });

  it("accepts an empty tags list (edge)", async () => {
    const { authHeader } = await signUp("author-notags@example.com");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Sem tags", bodyMarkdown: "corpo", tags: [] }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual([]);
  });
});

describe("GET /posts", () => {
  it("lists only published posts (positive)", async () => {
    const { authHeader } = await signUp("author-list@example.com");

    const draft = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Rascunho Listagem", bodyMarkdown: "x" }),
    });
    const draftBody = await draft.json();

    const published = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Publicado Listagem", bodyMarkdown: "y", status: "published" }),
    });
    const publishedBody = await published.json();

    const res = await app.request("/posts");
    expect(res.status).toBe(200);
    const body = await res.json();
    const slugs = body.posts.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(publishedBody.slug);
    expect(slugs).not.toContain(draftBody.slug);
  });

  it("returns an empty list when nothing is published yet (edge)", async () => {
    const started = await startTestDb();
    const freshAuth = createAuth(started.db, "another-test-secret-also-32-chars-min");
    const freshApp = createApp(started.db, freshAuth);

    const res = await freshApp.request("/posts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toEqual([]);

    await started.stop();
  }, 30_000);
});

describe("GET /posts/:slug", () => {
  it("returns a single published post by slug (positive)", async () => {
    const { authHeader } = await signUp("author-get@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Post Individual", bodyMarkdown: "conteudo", status: "published" }),
    });
    const created = await create.json();

    const res = await app.request(`/posts/${created.slug}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Post Individual");
  });

  it("404s for a nonexistent slug (negative)", async () => {
    const res = await app.request("/posts/isso-nao-existe");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /posts/:id", () => {
  it("lets the owner update their own post (positive)", async () => {
    const { authHeader } = await signUp("author-patch-owner@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Original", bodyMarkdown: "v1" }),
    });
    const created = await create.json();

    const res = await app.request(`/posts/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Editado" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Editado");
  });

  it("rejects an edit from a non-owner (negative)", async () => {
    const owner = await signUp("author-patch-owner2@example.com");
    const other = await signUp("author-patch-intruder@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: owner.authHeader },
      body: JSON.stringify({ title: "Protegido", bodyMarkdown: "v1" }),
    });
    const created = await create.json();

    const res = await app.request(`/posts/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: other.authHeader },
      body: JSON.stringify({ title: "Hackeado" }),
    });

    expect(res.status).toBe(403);
  });

  it("404s when editing a nonexistent post id (negative/edge)", async () => {
    const { authHeader } = await signUp("author-patch-missing@example.com");
    const res = await app.request("/posts/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /posts/:id", () => {
  it("lets the owner delete their own post (positive)", async () => {
    const { authHeader } = await signUp("author-delete-owner@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Deletar Este", bodyMarkdown: "v1", status: "published" }),
    });
    const created = await create.json();

    const del = await app.request(`/posts/${created.id}`, {
      method: "DELETE",
      headers: { authorization: authHeader },
    });
    expect(del.status).toBe(204);

    const getAfter = await app.request(`/posts/${created.slug}`);
    expect(getAfter.status).toBe(404);
  });

  it("rejects a delete from a non-owner (negative)", async () => {
    const owner = await signUp("author-delete-owner2@example.com");
    const other = await signUp("author-delete-intruder@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: owner.authHeader },
      body: JSON.stringify({ title: "Protegido Delete", bodyMarkdown: "v1" }),
    });
    const created = await create.json();

    const res = await app.request(`/posts/${created.id}`, {
      method: "DELETE",
      headers: { authorization: other.authHeader },
    });
    expect(res.status).toBe(403);
  });
});
