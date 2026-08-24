import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { fakeAuth, authHeaders } from "../fakeAuth.js";
import { startTestDb } from "../testDb.js";

describe("rooms", () => {
  let app: ReturnType<typeof createApp>["app"];
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await startTestDb();
    stop = testDb.stop;
    ({ app } = createApp(fakeAuth(), testDb.db, ["http://localhost:5173"]));
  });

  afterAll(() => stop());

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
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.title).toBe("Clube do Livro: Duna");
    expect(created.hostId).toBe("user-1");
    expect(created.currentPage).toBe(1);

    const listRes = await app.request("/rooms");
    const { rooms } = await listRes.json();
    expect(rooms.some((r: { id: string }) => r.id === created.id)).toBe(true);

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
    expect(okDelete.status).toBe(204);

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
