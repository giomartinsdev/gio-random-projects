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
let db: Awaited<ReturnType<typeof startTestDb>>["db"];

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  db = dbStarted.db;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");
}, 60_000);

afterAll(async () => {
  await stopDb();
});

describe("POST /discord/token", () => {
  it("is absent entirely when DISCORD_CLIENT_ID/SECRET aren't configured (negative)", async () => {
    const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
    const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);
    const app: App = createApp(auth, domainApi, ["http://localhost:5173"], db);

    const res = await app.request("/discord/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "whatever" }),
    });

    expect(res.status).toBe(404);
    await fakeDomainApi.stop();
  });

  it("rejects a request with no code once the route is configured (edge)", async () => {
    const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
    const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);
    const app: App = createApp(auth, domainApi, ["http://localhost:5173"], db, {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });

    const res = await app.request("/discord/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    await fakeDomainApi.stop();
  });

  it("sign-in/social builds a Discord authorization redirect for the web login button (positive)", async () => {
    const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
    const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);
    // The web flow needs trustedOrigins + baseURL so the callbackURL
    // and the Discord redirect_uri resolve to the deployed hosts.
    const webAuth = createAuth(db, "test-secret-do-not-use-in-production-min-32-chars", "https://post-api.giomartins.dev", [
      "http://localhost:5173",
    ], {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    const app: App = createApp(webAuth, domainApi, ["http://localhost:5173"], db, {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });

    const res = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "discord", callbackURL: "http://localhost:5173/" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirect).toBe(true);
    expect(String(body.url)).toContain("discord.com/api/oauth2/authorize");
    expect(String(body.url)).toContain("prompt=consent");
    await fakeDomainApi.stop();
  });
});
