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

async function signUp(email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", name: "Test Dev" }),
  });
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return { authHeader: `Bearer ${token}` };
}

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");

  const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
  stopDomainApi = fakeDomainApi.stop;
  const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);

  app = createApp(auth, domainApi, ["https://classroom-bdd.giomartins.dev"]);
}, 60_000);

afterAll(async () => {
  await stopDb();
  await stopDomainApi();
});

describe("GET /feed.xml", () => {
  it("lists a published post as an RSS item with an absolute link (positive)", async () => {
    const { authHeader } = await signUp("feed-author@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({
        title: "Publicado no feed",
        bodyMarkdown: "# Título\n\nConteúdo do post.",
        status: "published",
      }),
    });

    const res = await app.request("/feed.xml");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<title>Publicado no feed</title>");
    expect(xml).toContain("https://classroom-bdd.giomartins.dev/posts/");
  });

  it("omits a draft post from the feed (negative)", async () => {
    const { authHeader } = await signUp("feed-author-2@example.com");
    await app.request("/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({
        title: "Rascunho que não deve aparecer",
        bodyMarkdown: "Conteúdo",
        status: "draft",
      }),
    });

    const res = await app.request("/feed.xml");
    const xml = await res.text();

    expect(xml).not.toContain("Rascunho que não deve aparecer");
  });

  it("is reachable with no auth header (edge)", async () => {
    const res = await app.request("/feed.xml");
    expect(res.status).toBe(200);
  });
});
