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

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");
}, 60_000);

afterAll(async () => {
  await stopDb();
});

describe("POST /discord/token", () => {
  it("is absent entirely when DISCORD_CLIENT_ID/SECRET aren't configured (negative)", async () => {
    const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
    const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);
    const app: App = createApp(auth, domainApi, ["http://localhost:5173"]);

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
    const app: App = createApp(auth, domainApi, ["http://localhost:5173"], {
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
});
