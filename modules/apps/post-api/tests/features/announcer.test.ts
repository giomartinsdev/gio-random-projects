import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { createPostAnnouncer } from "../../src/lib/announcer.js";
import { startTestDb } from "../testDb.js";
import type { Db } from "../../src/db/index.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";
import { announcedPosts } from "../../src/db/schema.js";

const DOMAIN_API_KEY = "test-domain-api-key";
const SITE_URL = "https://blog.test";

let stopDb: () => Promise<void>;
let stopDomainApi: () => Promise<void>;
let stopWebhook: () => Promise<void>;
let db: Db;
let announcer: ReturnType<typeof createPostAnnouncer>;

// Stand-in for Discord's webhook: records every payload, and a
// mutable status code lets tests aim at the failure path.
let webhookBodies: { content: string }[];
let webhookStatus: number;

async function createDomainPost(input: { title: string; status?: string; publishedAt?: string }) {
  const res = await fetch(`${domainApiUrl}/posts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DOMAIN_API_KEY },
    body: JSON.stringify({
      author_id: "author-1",
      title: input.title,
      body_markdown: `conteudo de ${input.title}`,
      status: input.status ?? "published",
      published_at: input.publishedAt,
    }),
  });
  expect(res.status).toBe(202);
}

function postedTitles(): string[] {
  return webhookBodies.map((b) => b.content.replace(/^📰 /, "").split("\n")[0]);
}

let domainApiUrl: string;

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  db = dbStarted.db;

  const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
  stopDomainApi = fakeDomainApi.stop;
  domainApiUrl = fakeDomainApi.url;
  const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);

  const webhookServer = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      webhookBodies.push(JSON.parse(data));
      res.statusCode = webhookStatus;
      res.end();
    });
  });
  webhookServer.listen(0);
  const addr = webhookServer.address();
  const webhookPort = addr && typeof addr === "object" ? addr.port : 0;
  webhookBodies = [];
  webhookStatus = 204;
  stopWebhook = () => new Promise<void>((resolve) => webhookServer.close(() => resolve()));

  announcer = createPostAnnouncer({
    db: dbStarted.db,
    domainApi,
    webhookUrl: `http://127.0.0.1:${webhookPort}/discord-webhook`,
    siteUrl: SITE_URL,
  });
}, 60_000);

afterAll(async () => {
  await stopDb();
  await stopDomainApi();
  await stopWebhook();
});

describe("announcer", () => {
  it("announces a fresh published post once and never repeats it (positive + idempotency)", async () => {
    webhookBodies = [];
    await createDomainPost({ title: "Post que merece anuncio" });

    expect(await announcer.announceOnce()).toBe(1);
    expect(webhookBodies).toHaveLength(1);
    expect(webhookBodies[0].content).toContain("**Post que merece anuncio**");
    expect(webhookBodies[0].content).toContain(`${SITE_URL}/posts/`);

    expect(await announcer.announceOnce()).toBe(0);
    expect(webhookBodies).toHaveLength(1);
  });

  it("ignores drafts and posts older than 24h (negative)", async () => {
    webhookBodies = [];
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await createDomainPost({ title: "Rascunho nao anuncio", status: "draft" });
    await createDomainPost({ title: "Post velho nao anuncio", publishedAt: twoDaysAgo });

    expect(await announcer.announceOnce()).toBe(0);
    expect(webhookBodies).toHaveLength(0);
  });

  it("caps at 3 per sweep and drains the backlog oldest-first on later sweeps", async () => {
    webhookBodies = [];
    for (const title of ["Fila 1", "Fila 2", "Fila 3", "Fila 4", "Fila 5"]) await createDomainPost({ title });

    expect(await announcer.announceOnce()).toBe(3);
    expect(postedTitles()).toEqual(["**Fila 1**", "**Fila 2**", "**Fila 3**"]);

    expect(await announcer.announceOnce()).toBe(2);
    expect(postedTitles().slice(3)).toEqual(["**Fila 4**", "**Fila 5**"]);
  });

  it("does not mark a post announced when the webhook rejects it -- next sweep retries (edge)", async () => {
    webhookBodies = [];
    await createDomainPost({ title: "Tentativa com falha" });

    webhookStatus = 500;
    expect(await announcer.announceOnce()).toBe(0);

    webhookStatus = 204;
    expect(await announcer.announceOnce()).toBe(1);
    expect(webhookBodies[0].content).toContain("**Tentativa com falha**");
  });

  it("leaves announced rows exactly for what Discord accepted (state audit)", async () => {
    // 1 (first test) + 5 (queue test) + 1 (retry test) = 7; the draft
    // and the 48h-old post -- plus the failed webhook attempt the first
    // time around -- must not sit in the table.
    const rows = await db.select({ postId: announcedPosts.postId }).from(announcedPosts);
    expect(rows).toHaveLength(7);
  });
});