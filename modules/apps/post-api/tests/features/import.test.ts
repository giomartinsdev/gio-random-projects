import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  expect(res.status).toBe(200);
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return `Bearer ${token}`;
}

// The import never hits the network for real: every upstream reply
// comes from the fake handed to globalThis.fetch (the route uses the
// adapter's default fetchFn, resolved at call time, so stubGlobal
// reaches it). Returns what it captured for URL-shape assertions.
function stubUpstream(handler: (url: string) => Response) {
  let requested: string[] = [];
  vi.stubGlobal("fetch", ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    return handler(url);
  }) as typeof fetch);
  return {
    requested: () => requested,
  };
}

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /posts/import", () => {
  it("requires a session (401 without a bearer token)", async () => {
    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://dev.to/user/post" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing url (400)", async () => {
    const bearer = await signUp(`imp-nourl-${crypto.randomUUID()}@example.com`);
    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "url is required" });
  });

  it("rejects hosts outside the provider allowlist (400) -- localhost included (negative, SSRF shape)", async () => {
    const bearer = await signUp(`imp-hosts-${crypto.randomUUID()}@example.com`);
    for (const url of ["https://github.com/foo/bar", "http://localhost:5001/dev-api", "ftp://dev.to/post"]) {
      const res = await app.request("/posts/import", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify({ url }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("pulls a dev.to article via its API and appends the attribution footer (positive)", async () => {
    const bearer = await signUp(`imp-devto-${crypto.randomUUID()}@example.com`);
    const upstream = stubUpstream((url) =>
      url === "https://dev.to/api/articles/alguem/meu-slug-1a2b"
        ? json({
            title: "Testando o importador",
            description: "Um resumo qualquer",
            body_markdown: "Texto original do dev.to.",
            cover_image: "https://media2.dev.to/capa.png",
            user: { username: "alguem" },
          })
        : json({}),
    );

    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ url: "https://dev.to/alguem/meu-slug-1a2b" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; title: string; bodyMarkdown: string; excerpt?: string; coverImageUrl?: string; originalUrl: string };
    expect(upstream.requested()).toEqual(["https://dev.to/api/articles/alguem/meu-slug-1a2b"]);
    expect(body.provider).toBe("dev.to");
    expect(body.title).toBe("Testando o importador");
    expect(body.excerpt).toBe("Um resumo qualquer");
    expect(body.coverImageUrl).toBe("https://media2.dev.to/capa.png");
    expect(body.originalUrl).toBe("https://dev.to/alguem/meu-slug-1a2b");
    expect(body.bodyMarkdown.startsWith("Texto original do dev.to.")).toBe(true);
    expect(body.bodyMarkdown).toContain("Retirado daqui do dev.to");
    expect(body.bodyMarkdown).toContain("[@alguem](https://dev.to/alguem)");
    expect(body.bodyMarkdown).toContain(`[link original](https://dev.to/alguem/meu-slug-1a2b)`);
  });

  it("pulls a TabNews article (markdown comes straight from its API) with attribution (positive)", async () => {
    const bearer = await signUp(`imp-tabnews-${crypto.randomUUID()}@example.com`);
    const upstream = stubUpstream((url) =>
      url === "https://www.tabnews.com.br/api/v1/contents/joao/primeiros-passos"
        ? json({
            title: "Primeiros passos",
            body: "# Primeiros passos\n\nCorpo em markdown puro.",
            owner_username: "joao",
          })
        : json({}),
    );

    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ url: "https://www.tabnews.com.br/joao/primeiros-passos" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; bodyMarkdown: string };
    expect(upstream.requested()).toEqual(["https://www.tabnews.com.br/api/v1/contents/joao/primeiros-passos"]);
    expect(body.provider).toBe("tabnews");
    expect(body.bodyMarkdown.startsWith("# Primeiros passos")).toBe(true);
    expect(body.bodyMarkdown).toContain("Retirado daqui do TabNews");
    expect(body.bodyMarkdown).toContain("[@joao](https://www.tabnews.com.br/joao)");
  });

  it("scrapes a Medium page (title h1, og:image cover, attribution, no duplicate title heading)", async () => {
    const bearer = await signUp(`imp-medium-${crypto.randomUUID()}@example.com`);
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn-images-1.medium.com/capa.jpg">
    </head><body><main><article>
      <h1>Como aprender Go</h1>
      <p>Primeiro parágrafo com <strong>destaque</strong> e <a href="https://go.dev">link</a>.</p>
      <pre><code>npm i</code></pre>
    </article></main></body></html>`;
    stubUpstream(() => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));

    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ url: "https://medium.com/@fulano/como-aprender-go" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; title: string; bodyMarkdown: string; coverImageUrl?: string; excerpt?: string };
    expect(body.provider).toBe("medium");
    expect(body.title).toBe("Como aprender Go");
    expect(body.coverImageUrl).toBe("https://cdn-images-1.medium.com/capa.jpg");
    expect(body.excerpt).toContain("Primeiro parágrafo");
    // The h1 became the title, so the body must not open with it again.
    expect(body.bodyMarkdown.startsWith("# Como aprender Go")).toBe(false);
    expect(body.bodyMarkdown).toContain("**destaque**");
    expect(body.bodyMarkdown).toContain("[link](https://go.dev)");
    expect(body.bodyMarkdown).toContain('```\nnpm i\n```');
    expect(body.bodyMarkdown).toContain("Retirado daqui do Medium");
    expect(body.bodyMarkdown).toContain("[@fulano](https://medium.com/@fulano)");
  });

  it("maps an upstream 404 to 502 (edge)", async () => {
    const bearer = await signUp(`imp-404-${crypto.randomUUID()}@example.com`);
    stubUpstream(() => new Response("not found", { status: 404 }));

    const res = await app.request("/posts/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ url: "https://dev.to/alguem/nao-existe" }),
    });

    expect(res.status).toBe(502);
  });
});