import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { DomainRoom } from "../src/lib/domainApiClient.js";

// A real HTTP server standing in for domain-api's Room/Message contract
// (X-API-Key auth, synchronous-for-tests writes) -- same "fake the
// other system's contract, keep everything else real" approach
// post-api's own tests/fakeDomainApi.ts uses. Room updates/deletes
// enforce the same host_id ownership check domain-worker's real
// aggregate does, since that's part of the contract too.
export function startFakeDomainApi(apiKey: string) {
  const rooms = new Map<string, DomainRoom>();
  const messages = new Map<string, { id: string; room_id: string; user_id: string; user_name: string; body: string; requested_page: number | null; created_at: string }[]>();

  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.header("x-api-key") !== apiKey) {
      return c.json({ error: "missing or invalid API key" }, 401);
    }
    await next();
  });

  app.get("/rooms", (c) => {
    return c.json({ rooms: [...rooms.values()] });
  });

  app.post("/rooms", async (c) => {
    const body = await c.req.json();
    if (!body.host_id || !body.title || !body.document_id) {
      return c.json({ error: "host_id, title and document_id are required" }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const room: DomainRoom = {
      id,
      host_id: body.host_id,
      title: body.title,
      document_id: body.document_id,
      current_page: 1,
      created_at: now,
      updated_at: now,
    };
    rooms.set(id, room);
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  app.get("/rooms/:id", (c) => {
    const room = rooms.get(c.req.param("id"));
    if (!room) return c.json({ error: "not found" }, 404);
    return c.json(room);
  });

  app.put("/rooms/:id", async (c) => {
    const room = rooms.get(c.req.param("id"));
    if (!room) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    if (body.host_id !== room.host_id) return c.json({ error: "only the host may modify this room" }, 400);
    Object.assign(room, {
      title: body.title || room.title,
      current_page: body.current_page ?? room.current_page,
      updated_at: new Date().toISOString(),
    });
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  app.delete("/rooms/:id", async (c) => {
    const room = rooms.get(c.req.param("id"));
    if (!room) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    if (body.host_id !== room.host_id) return c.json({ error: "only the host may modify this room" }, 400);
    rooms.delete(c.req.param("id"));
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  app.get("/messages", (c) => {
    const roomId = c.req.query("room_id");
    if (!roomId) return c.json({ error: "room_id query param is required" }, 400);
    return c.json({ messages: messages.get(roomId) ?? [] });
  });

  app.post("/messages", async (c) => {
    const body = await c.req.json();
    if (!body.room_id || !body.user_id || !body.body) {
      return c.json({ error: "room_id, user_id and body are required" }, 400);
    }
    const list = messages.get(body.room_id) ?? [];
    list.push({
      id: crypto.randomUUID(),
      room_id: body.room_id,
      user_id: body.user_id,
      user_name: body.user_name ?? "",
      body: body.body,
      requested_page: body.requested_page ?? null,
      created_at: new Date().toISOString(),
    });
    messages.set(body.room_id, list);
    return c.json({ command_id: crypto.randomUUID(), status: "accepted" }, 202);
  });

  const server = serve({ fetch: app.fetch, port: 0 });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
