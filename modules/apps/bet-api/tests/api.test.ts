import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { createAccessAuth } from "../src/lib/accessAuth.js";
import { createCredentialCrypto } from "../src/lib/crypto.js";
import { startTestDb, type TestDb } from "./testDb.js";

// The whole app, wired like index.ts does but pointed at the
// testcontainers DB, with the dev-email auth path (no JWT, no JWKS
// fetch) doing the identity work.
const RUNNER_KEY = "test-runner-key";
const DEV_EMAIL = "gio@test.dev";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
});

afterAll(async () => {
  await testDb.stop();
});

// One container serves the whole file; each test starts from empty
// tables so credentials/bets from one test can't leak into the next
// (the claim loop especially — leftover queued rows would claim first).
afterEach(async () => {
  await testDb.db.execute(sql`truncate bet_bets, bet_credentials, bet_users`);
});

function buildApp(opts: { devEmail?: string } = {}) {
  return createApp({
    db: testDb.db,
    frontendOrigins: ["http://localhost:5173", "https://bet.giomartins.dev"],
    accessAuth: createAccessAuth({
      teamDomain: "team.example.cloudflareaccess.com",
      aud: "test-aud",
      devEmail: opts.devEmail ?? DEV_EMAIL,
    }),
    credentialCrypto: createCredentialCrypto("a".repeat(64)),
    runnerApiKey: RUNNER_KEY,
  });
}

function publicRequest(app: ReturnType<typeof buildApp>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function runnerRequest(app: ReturnType<typeof buildApp>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", "x-runner-key": RUNNER_KEY, ...(init.headers ?? {}) },
  });
}

async function queueBet(app: ReturnType<typeof buildApp>, url: string, units: number) {
  const res = await publicRequest(app, "/api/bets", {
    method: "POST",
    body: JSON.stringify({ url, units }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; stakeCents: number; status: string }>;
}

describe("bet-api routes", () => {
  it("requires identity on /api/* when there is no dev fallback", async () => {
    const app = createApp({
      db: testDb.db,
      frontendOrigins: ["http://localhost:5173"],
      accessAuth: createAccessAuth({
        teamDomain: "team.example.cloudflareaccess.com",
        aud: "test-aud",
        // No devEmail: unauthenticated means unauthenticated.
      }),
      credentialCrypto: createCredentialCrypto("a".repeat(64)),
      runnerApiKey: RUNNER_KEY,
    });
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("auto-provisions the user and returns unit value + known vendors", async () => {
    const app = buildApp();
    const res = await publicRequest(app, "/api/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      unitValueCents: number;
      knownVendors: { id: string }[];
    };
    expect(body.email).toBe(DEV_EMAIL);
    expect(body.unitValueCents).toBe(100); // default R$ 1,00
    expect(body.knownVendors.map((v) => v.id)).toContain("betano");
  });

  it("changes the unit value and snapshots it into new bets only", async () => {
    const app = buildApp();

    await publicRequest(app, "/api/credentials/betano", {
      method: "PUT",
      body: JSON.stringify({ username: "gio@betano.com", password: "pw1" }),
    });

    const put = await publicRequest(app, "/api/me/settings", {
      method: "PUT",
      body: JSON.stringify({ unitValueCents: 250 }),
    });
    expect(put.status).toBe(200);

    const bad = await publicRequest(app, "/api/me/settings", {
      method: "PUT",
      body: JSON.stringify({ unitValueCents: 0 }),
    });
    expect(bad.status).toBe(400);

    // First bet: 2 units × R$ 2,50 snapshot.
    const first = await queueBet(app, "https://www.betano.com.br/market/1", 2);
    expect(first.stakeCents).toBe(500);

    // Unit value changes afterwards; the queued bet keeps its snapshot
    // and the NEW one snapshots the new value (3 × R$ 1,00).
    await publicRequest(app, "/api/me/settings", {
      method: "PUT",
      body: JSON.stringify({ unitValueCents: 100 }),
    });
    const second = await queueBet(app, "https://www.betano.com.br/market/2", 3);
    expect(second.stakeCents).toBe(300);

    const list = (await (await publicRequest(app, "/api/bets")).json()) as { bets: unknown[] };
    expect(list.bets).toHaveLength(2);
  });

  it("rejects unknown vendors and missing credentials", async () => {
    const app = buildApp();

    const otherHouse = await publicRequest(app, "/api/bets", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.bet365.com/x", units: 1 }),
    });
    expect(otherHouse.status).toBe(400);

    const noCreds = await publicRequest(app, "/api/bets", {
      method: "POST",
      body: JSON.stringify({ url: "https://betano.com.br/market/9", units: 1 }),
    });
    expect(noCreds.status).toBe(400);
    const body = (await noCreds.json()) as { error: string };
    expect(body.error).toContain("credenciais");
  });

  it("rejects units outside 1..100", async () => {
    const app = buildApp();
    await publicRequest(app, "/api/credentials/betano", {
      method: "PUT",
      body: JSON.stringify({ username: "gio@betano.com", password: "pw" }),
    });

    for (const units of [0, -1, 101, 2.5]) {
      const res = await publicRequest(app, "/api/bets", {
        method: "POST",
        body: JSON.stringify({ url: "https://betano.com.br/x", units }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("hands the runner the oldest queued bet with DECRYPTED credentials, then accepts its result", async () => {
    const app = buildApp();

    await publicRequest(app, "/api/credentials/betano", {
      method: "PUT",
      body: JSON.stringify({ username: "gio@betano.com", password: "s3cret" }),
    });
    const created = await queueBet(app, "https://betano.com.br/market/ok", 1);

    // Wrong key gets nothing.
    const denied = await app.request("/internal/jobs/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-runner-key": "wrong" },
      body: "{}",
    });
    expect(denied.status).toBe(401);

    const claimRes = await runnerRequest(app, "/internal/jobs/claim", { method: "POST", body: "{}" });
    expect(claimRes.status).toBe(200);
    const claim = (await claimRes.json()) as {
      bet: { id: string; status: string };
      credentials: { username: string; password: string };
    };
    expect(claim.bet.id).toBe(created.id);
    expect(claim.bet.status).toBe("running");
    expect(claim.credentials.username).toBe("gio@betano.com");
    expect(claim.credentials.password).toBe("s3cret");

    const result = await runnerRequest(app, `/internal/jobs/${created.id}/result`, {
      method: "POST",
      body: JSON.stringify({
        status: "succeeded",
        receipt: { steps: ["abriu o link", "apostou"], betRef: "B-123", balanceCents: 9500 },
      }),
    });
    expect(result.status).toBe(200);

    const detail = (await (await publicRequest(app, `/api/bets/${created.id}`)).json()) as {
      status: string;
      receipt: { betRef: string; steps: string[] };
    };
    expect(detail.status).toBe("succeeded");
    expect(detail.receipt.betRef).toBe("B-123");
    expect(detail.receipt.steps).toEqual(["abriu o link", "apostou"]);

    // A second result for a finished bet is a 409, not a rewrite.
    const dup = await runnerRequest(app, `/internal/jobs/${created.id}/result`, {
      method: "POST",
      body: JSON.stringify({ status: "failed", error: "stale" }),
    });
    expect(dup.status).toBe(409);
  });

  it("fails a queued bet whose credentials disappeared, then claims the next one", async () => {
    const app = buildApp();

    await publicRequest(app, "/api/credentials/betano", {
      method: "PUT",
      body: JSON.stringify({ username: "gio@betano.com", password: "pw1" }),
    });
    const doomed = await queueBet(app, "https://betano.com.br/doomed", 1);

    // Credentials gone BEFORE the claim: the doomed bet fails inside
    // the claim transaction and this claim hands out nothing.
    const del = await publicRequest(app, "/api/credentials/betano", { method: "DELETE" });
    expect(del.status).toBe(200);

    const empty = await runnerRequest(app, "/internal/jobs/claim", { method: "POST", body: "{}" });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { bet: unknown }).bet).toBeNull();

    // Credentials are back and a new bet is queued: the next claim
    // hands THAT one, with the fresh password.
    await publicRequest(app, "/api/credentials/betano", {
      method: "PUT",
      body: JSON.stringify({ username: "gio@betano.com", password: "pw2" }),
    });
    const survivor = await queueBet(app, "https://betano.com.br/next", 1);

    const claim = (await (
      await runnerRequest(app, "/internal/jobs/claim", { method: "POST", body: "{}" })
    ).json()) as { bet: { id: string }; credentials: { password: string } };

    expect(claim.bet.id).toBe(survivor.id);
    expect(claim.credentials.password).toBe("pw2");

    const detail = (await (await publicRequest(app, `/api/bets/${doomed.id}`)).json()) as {
      status: string;
      error: string;
    };
    expect(detail.status).toBe("failed");
    expect(detail.error).toContain("removidas");
  });
});