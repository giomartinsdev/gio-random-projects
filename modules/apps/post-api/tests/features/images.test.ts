import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/app.js";
import { createAuth, type Auth } from "../../src/lib/auth.js";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { startTestDb } from "../testDb.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";
import type { Uploader } from "../../src/lib/minioClient.js";

const DOMAIN_API_KEY = "test-domain-api-key";

let stopDb: () => Promise<void>;
let stopDomainApi: () => Promise<void>;
let auth: Auth;
let app: App;
// Reassigned per-test so each case aims its fake at the behavior it
// exercises (default below is the happy path).
let uploadImpl: Uploader["upload"] = async (key) => `http://media.test/${key}`;

const fakeUploader: Uploader = {
  async upload(key, data, contentType) {
    return uploadImpl(key, data, contentType);
  },
};

async function signUp(email: string, name = "Test Dev") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", name }),
  });
  expect(res.status).toBe(200);
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return `Bearer ${token}`;
}

// Real PNG magic bytes, not a string wearing an image content-type --
// keeps the allowlist branch exercised exactly as production hits it.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function multipart(contentType: string, size = PNG.byteLength) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], "pic.png", { type: contentType }));
  return form;
}

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");

  const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
  stopDomainApi = fakeDomainApi.stop;
  const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);

  app = createApp(auth, domainApi, ["http://localhost:5173"], dbStarted.db, undefined, fakeUploader);
}, 60_000);

afterAll(async () => {
  await stopDb();
  await stopDomainApi();
});

describe("POST /images/upload", () => {
  it("requires a session", async () => {
    const res = await app.request("/images/upload", { method: "POST", body: multipart("image/png") });
    expect(res.status).toBe(401);
  });

  it("stores the file under the author's scope and returns its public URL (positive)", async () => {
    const bearer = await signUp(`img-ok-${crypto.randomUUID()}@example.com`);
    let seenKey: string | undefined;
    uploadImpl = async (key) => {
      seenKey = key;
      return `http://media.test/${key}`;
    };

    const res = await app.request("/images/upload", {
      method: "POST",
      headers: { authorization: bearer },
      body: multipart("image/png"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    // <userId>/<uuid>.<ext> -- author-scoped, never user-named.
    expect(seenKey).toMatch(/\/[0-9a-f-]{36}\.png$/);
    expect(body.url).toBe(`http://media.test/${seenKey}`);
  });

  it("rejects non-image content types and oversized files (negative)", async () => {
    const bearer = await signUp(`img-bad-${crypto.randomUUID()}@example.com`);

    const html = await app.request("/images/upload", {
      method: "POST",
      headers: { authorization: bearer },
      body: multipart("text/html"),
    });
    expect(html.status).toBe(400);

    uploadImpl = async () => {
      throw new Error("must not be called");
    };
    const huge = await app.request("/images/upload", {
      method: "POST",
      headers: { authorization: bearer },
      body: multipart("image/jpeg", 8 * 1024 * 1024 + 1),
    });
    expect(huge.status).toBe(400);
  });

  it("maps a storage failure to 502 so the client can retry (edge)", async () => {
    const bearer = await signUp(`img-502-${crypto.randomUUID()}@example.com`);
    uploadImpl = async () => {
      throw new Error("minio down");
    };
    const res = await app.request("/images/upload", {
      method: "POST",
      headers: { authorization: bearer },
      body: multipart("image/webp"),
    });
    expect(res.status).toBe(502);
  });
});