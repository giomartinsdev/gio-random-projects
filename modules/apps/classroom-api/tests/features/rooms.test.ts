import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { fakeAuth, authHeaders } from "../fakeAuth.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";

describe("rooms", () => {
  let app: ReturnType<typeof createApp>["app"];
  let stopDomainApi: () => Promise<void>;

  beforeAll(async () => {
    const fakeDomainApi = startFakeDomainApi("test-key");
    stopDomainApi = fakeDomainApi.stop;
    const domainApi = createDomainApiClient(fakeDomainApi.url, "test-key");

    ({ app } = createApp(fakeAuth(), domainApi, ["http://localhost:5173"]));
  });

  afterAll(async () => {
    await stopDomainApi();
  });

  it("rejects room creation without a session", async () => {
    const res = await app.request("/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Sem sessão" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a room with no title", async () => {
    const res = await app.request("/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders("user-1", "Gio") },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("creates a class, lists it, and only its host can end it", async () => {
    const createRes = await app.request("/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders("user-1", "Gio") },
      body: JSON.stringify({ title: "Aula de Go: introdução" }),
    });
    expect(createRes.status).toBe(202);

    // Room creation is async (domain-worker applies it) -- the fake
    // domain-api in these tests applies synchronously, so it's already
    // there by the time listRooms is called next.
    const listRes = await app.request("/rooms");
    const { rooms } = await listRes.json();
    expect(rooms).toHaveLength(1);
    const created = rooms[0];
    expect(created.title).toBe("Aula de Go: introdução");
    expect(created.hostId).toBe("user-1");
    expect(created.status).toBe("open");

    const getRes = await app.request(`/rooms/${created.id}`);
    expect(getRes.status).toBe(200);

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

    // "Encerrar aula" is a soft close, not a deletion -- the room
    // stays gettable (now with status "closed").
    const afterDelete = await app.request(`/rooms/${created.id}`);
    expect(afterDelete.status).toBe(200);
    const closedRoom = await afterDelete.json();
    expect(closedRoom.status).toBe("closed");
  });
});
