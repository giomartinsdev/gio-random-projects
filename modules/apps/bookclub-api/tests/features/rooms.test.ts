import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { fakeAuth, authHeaders } from "../fakeAuth.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";
import { startTestDb } from "../testDb.js";
import { startTestMinio } from "../testMinio.js";

describe("rooms", () => {
  let app: ReturnType<typeof createApp>["app"];
  let stopDb: () => Promise<void>;
  let stopDomainApi: () => Promise<void>;
  let stopMinio: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await startTestDb();
    stopDb = testDb.stop;

    const testMinio = await startTestMinio();
    stopMinio = testMinio.stop;

    const fakeDomainApi = startFakeDomainApi("test-key");
    stopDomainApi = fakeDomainApi.stop;
    const domainApi = createDomainApiClient(fakeDomainApi.url, "test-key");

    ({ app } = createApp(fakeAuth(), testDb.db, domainApi, testMinio.minio, ["http://localhost:5173"]));
  });

  afterAll(async () => {
    await stopDb();
    await stopDomainApi();
    await stopMinio();
  });

  function pdfFormData(title: string, bytes = "%PDF-1.4 fake") {
    const form = new FormData();
    form.set("title", title);
    form.set("pdf", new File([bytes], "book.pdf", { type: "application/pdf" }));
    return form;
  }

  it("rejects room creation without a session", async () => {
    const res = await app.request("/rooms", { method: "POST", body: pdfFormData("Sem sessão") });
    expect(res.status).toBe(401);
  });

  it("rejects a non-PDF file", async () => {
    const form = new FormData();
    form.set("title", "Not a pdf");
    form.set("pdf", new File(["hello"], "book.txt", { type: "text/plain" }));

    const res = await app.request("/rooms", {
      method: "POST",
      body: form,
      headers: authHeaders("user-1", "Gio"),
    });
    expect(res.status).toBe(400);
  });

  it("creates a room, lists it, fetches its PDF bytes, and only its host can delete it", async () => {
    const createRes = await app.request("/rooms", {
      method: "POST",
      body: pdfFormData("Clube do Livro: Duna"),
      headers: authHeaders("user-1", "Gio"),
    });
    expect(createRes.status).toBe(202);

    // Room creation is async (domain-worker applies it) -- the fake
    // domain-api in these tests applies synchronously, so it's already
    // there by the time listRooms is called next.
    const listRes = await app.request("/rooms");
    const { rooms } = await listRes.json();
    expect(rooms).toHaveLength(1);
    const created = rooms[0];
    expect(created.title).toBe("Clube do Livro: Duna");
    expect(created.hostId).toBe("user-1");
    expect(created.currentPage).toBe(1);

    const getRes = await app.request(`/rooms/${created.id}`);
    expect(getRes.status).toBe(200);

    const pdfRes = await app.request(`/rooms/${created.id}/pdf`, { headers: authHeaders("user-2", "Ana") });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    const bytes = await pdfRes.text();
    expect(bytes).toBe("%PDF-1.4 fake");

    const forbiddenDelete = await app.request(`/rooms/${created.id}`, {
      method: "DELETE",
      headers: authHeaders("user-2", "Ana"),
    });
    expect(forbiddenDelete.status).toBe(403);

    const okDelete = await app.request(`/rooms/${created.id}`, {
      method: "DELETE",
      headers: authHeaders("user-1", "Gio"),
    });
    expect(okDelete.status).toBe(202);

    const afterDelete = await app.request(`/rooms/${created.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it("rejects a room with no title", async () => {
    const form = new FormData();
    form.set("pdf", new File(["%PDF-1.4"], "book.pdf", { type: "application/pdf" }));

    const res = await app.request("/rooms", { method: "POST", body: form, headers: authHeaders("user-1", "Gio") });
    expect(res.status).toBe(400);
  });
});
