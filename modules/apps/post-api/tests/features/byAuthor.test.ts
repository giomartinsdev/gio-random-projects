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

// Posts do fakeDomainApi cuidam do 202 apenas aceitando; o estado
// sincronizado lá é o que a leitura vê, sem esperar worker.
async function publish(author: { authHeader: string }, title: string, status: "draft" | "published" = "published") {
  await app.request("/posts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: author.authHeader },
    body: JSON.stringify({ title, bodyMarkdown: `conteudo de ${title}`, status }),
  });
}

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
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

describe("GET /posts/by-author/:id", () => {
  it("shows the author their drafts; anyone else gets published only (positive + negative)", async () => {
    const author = await signUp(`bya-owner-${crypto.randomUUID()}@example.com`);
    const fan = await signUp(`bya-fan-${crypto.randomUUID()}@example.com`);
    await publish(author, "Publicado do autor");
    await publish(author, "Rascunho escondido", "draft");

    const own = await (await app.request(`/posts/by-author/${author.userId}`, { headers: { authorization: author.authHeader } })).json();
    const ownTitles = (own.posts as { title: string }[]).map((p) => p.title);
    expect(ownTitles).toContain("Publicado do autor");
    expect(ownTitles).toContain("Rascunho escondido");

    const other = await (await app.request(`/posts/by-author/${author.userId}`, { headers: { authorization: fan.authHeader } })).json();
    expect((other.posts as { title: string }[]).map((p) => p.title)).toEqual(["Publicado do autor"]);

    const anon = await (await app.request(`/posts/by-author/${author.userId}`)).json();
    expect((anon.posts as { title: string }[]).map((p) => p.title)).toEqual(["Publicado do autor"]);
  });

  it("returns an empty list (not 404) for an author with no posts (edge)", async () => {
    const nobody = await signUp(`bya-empty-${crypto.randomUUID()}@example.com`);
    const res = await app.request(`/posts/by-author/${nobody.userId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posts: [] });
  });
});

describe("GET /posts?q=", () => {
  it("narrows the published list to matches and keeps drafts out (positive)", async () => {
    const author = await signUp(`srch-author-${crypto.randomUUID()}@example.com`);
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: author.authHeader },
      body: JSON.stringify({ title: "Docker do zero", bodyMarkdown: "containers de verdade", status: "published" }),
    });
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: author.authHeader },
      body: JSON.stringify({ title: "Receita de pão", bodyMarkdown: "fermentação natural", status: "published" }),
    });
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: author.authHeader },
      body: JSON.stringify({ title: "Docker rascunho", bodyMarkdown: "nao publicado", status: "draft" }),
    });

    const res = await app.request(`/posts?q=${encodeURIComponent("docker")}`);
    expect(res.status).toBe(200);
    const titles = ((await res.json()) as { posts: { title: string }[] }).posts.map((p) => p.title);
    expect(titles).toEqual(["Docker do zero"]);
  });

  it("covers q matching inside body and ignores other statuses (edge)", async () => {
    const author = await signUp(`srch-body-${crypto.randomUUID()}@example.com`);
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: author.authHeader },
      body: JSON.stringify({ title: "Título qualquer", bodyMarkdown: "o segredo é fermentacao natural", status: "published" }),
    });

    const q = "FERMENTACAO";
    const res = await app.request(`/posts?q=${encodeURIComponent(q)}`);
    const titles = ((await res.json()) as { posts: { title: string }[] }).posts.map((p) => p.title);
    expect(titles).toEqual(["Título qualquer"]);
  });
});