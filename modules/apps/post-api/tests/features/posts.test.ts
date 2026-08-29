import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/app.js";
import { createAuth, type Auth } from "../../src/lib/auth.js";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { startTestDb } from "../testDb.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";

const DOMAIN_API_KEY = "test-domain-api-key";

let stopDb: () => Promise<void>;
let stopDomainApi: () => Promise<void>;
let auth: Auth;
let app: App;

async function signUp(email: string, name = "Test Dev") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", name }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return { authHeader: `Bearer ${token}`, userId: body.user.id as string };
}

let testDbDb: Awaited<ReturnType<typeof startTestDb>>["db"];

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  testDbDb = dbStarted.db;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");

  const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
  stopDomainApi = fakeDomainApi.stop;
  const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);

  app = createApp(auth, domainApi, ["http://localhost:5173"], dbStarted.db);
}, 60_000);

afterAll(async () => {
  await stopDb();
  await stopDomainApi();
});

describe("POST /posts", () => {
  it("forwards to domain-api and returns 202 Accepted for an authenticated user (positive)", async () => {
    const { authHeader } = await signUp("author-create@example.com");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({
        title: "Como escalar Terraform sem chorar",
        bodyMarkdown: "# Intro\n\nConteúdo aqui.",
        type: "article",
      }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    expect(body.command_id).toBeTruthy();
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
});

describe("GET /posts", () => {
  it("lists only published posts, reading straight from domain-api (positive)", async () => {
    const { authHeader } = await signUp("author-list@example.com");

    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Rascunho Listagem", bodyMarkdown: "x" }),
    });
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Publicado Listagem", bodyMarkdown: "y", status: "published" }),
    });

    const res = await app.request("/posts");
    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.posts.map((p: { title: string }) => p.title);
    expect(titles).toContain("Publicado Listagem");
    expect(titles).not.toContain("Rascunho Listagem");
  });

  it("returns an empty list when nothing is published yet (edge)", async () => {
    const fakeDomainApi = startFakeDomainApi("another-key");
    const domainApi = createDomainApiClient(fakeDomainApi.url, "another-key");
    const freshApp = createApp(auth, domainApi, ["http://localhost:5173"], testDbDb);

    const res = await freshApp.request("/posts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toEqual([]);

    await fakeDomainApi.stop();
  });
});

describe("GET /posts/:slug", () => {
  it("returns a single published post by slug, proxied from domain-api (positive)", async () => {
    const { authHeader } = await signUp("author-get@example.com");
    const create = await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Post Individual", bodyMarkdown: "conteudo", status: "published" }),
    });
    expect(create.status).toBe(202);

    const list = await (await app.request("/posts")).json();
    const created = list.posts.find((p: { title: string }) => p.title === "Post Individual");

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
  it("lets the owner update their own post, forwarding to domain-api (positive)", async () => {
    const { authHeader } = await signUp("author-patch-owner@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Original Patch Owner", bodyMarkdown: "v1", status: "published" }),
    });
    const list = await (await app.request("/posts")).json();
    const created = list.posts.find((p: { title: string }) => p.title === "Original Patch Owner");

    const res = await app.request(`/posts/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Editado" }),
    });

    expect(res.status).toBe(202);
  });

  it("rejects an edit from a non-owner (negative)", async () => {
    const owner = await signUp("author-patch-owner2@example.com");
    const other = await signUp("author-patch-intruder@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: owner.authHeader },
      body: JSON.stringify({ title: "Protegido Patch", bodyMarkdown: "v1", status: "published" }),
    });
    const list = await (await app.request("/posts")).json();
    const created = list.posts.find((p: { title: string }) => p.title === "Protegido Patch");

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

  it("rejects an unauthenticated edit (negative)", async () => {
    const res = await app.request("/posts/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /posts/:id", () => {
  it("lets the owner delete their own post (positive)", async () => {
    const { authHeader } = await signUp("author-delete-owner@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ title: "Deletar Este", bodyMarkdown: "v1", status: "published" }),
    });
    const list = await (await app.request("/posts")).json();
    const created = list.posts.find((p: { title: string }) => p.title === "Deletar Este");

    const del = await app.request(`/posts/${created.id}`, {
      method: "DELETE",
      headers: { authorization: authHeader },
    });
    expect(del.status).toBe(202);

    const getAfter = await app.request(`/posts/${created.slug}`);
    expect(getAfter.status).toBe(404);
  });

  it("rejects a delete from a non-owner (negative)", async () => {
    const owner = await signUp("author-delete-owner2@example.com");
    const other = await signUp("author-delete-intruder@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: owner.authHeader },
      body: JSON.stringify({ title: "Protegido Delete", bodyMarkdown: "v1", status: "published" }),
    });
    const list = await (await app.request("/posts")).json();
    const created = list.posts.find((p: { title: string }) => p.title === "Protegido Delete");

    const res = await app.request(`/posts/${created.id}`, {
      method: "DELETE",
      headers: { authorization: other.authHeader },
    });
    expect(res.status).toBe(403);
  });

  it("404s when deleting a nonexistent post id (edge)", async () => {
    const { authHeader } = await signUp("author-delete-missing@example.com");
    const res = await app.request("/posts/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      headers: { authorization: authHeader },
    });
    expect(res.status).toBe(404);
  });
});
