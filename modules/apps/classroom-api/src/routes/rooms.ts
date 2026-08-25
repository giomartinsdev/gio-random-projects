import { Hono } from "hono";
import type { Auth } from "../lib/auth.js";
import { DomainApiError, NotFoundError, type DomainApiClient, type DomainRoom } from "../lib/domainApiClient.js";

// The Discord Activity bearer session (see front's discordAuthToken.ts)
// can't reach the WS upgrade through a normal Authorization header --
// the browser WebSocket API has no way to set custom headers on the
// upgrade request. A `?token=` query param is the standard fallback,
// folded into an Authorization header here so auth.api.getSession sees
// the same shape either way. Identical to bookclub-api's own helper of
// the same name.
export function sessionRequestHeaders(req: Request): Headers {
  const headers = new Headers(req.headers);
  if (!headers.has("authorization")) {
    const token = new URL(req.url).searchParams.get("token");
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

async function requireUser(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: sessionRequestHeaders(c.req.raw) });
  return session?.user ?? null;
}

const TITLE_MAX = 200;

function serializeRoom(r: DomainRoom) {
  return {
    id: r.id,
    title: r.title,
    hostId: r.host_id,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function createRoomsRouter(auth: Auth, domainApi: DomainApiClient) {
  const router = new Hono();

  router.get("/", async (c) => {
    const { rooms } = await domainApi.listRooms();
    return c.json({ rooms: rooms.map(serializeRoom) });
  });

  router.post("/", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim().slice(0, TITLE_MAX) : "";
    if (!title) return c.json({ error: "title is required" }, 400);

    // 202: the room itself is created asynchronously by domain-worker,
    // same as bookclub-api's own rooms.ts -- the front navigates to
    // the room page on success regardless, which re-fetches once it's
    // actually there.
    const accepted = await domainApi.createRoom({ host_id: user.id, title });
    return c.json(accepted, 202);
  });

  router.get("/:id", async (c) => {
    try {
      const room = await domainApi.getRoom(c.req.param("id"));
      return c.json(serializeRoom(room));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // "Encerrar aula" -- a soft close (domain-worker's RoomRepository.Delete
  // sets status to "closed"), not a deletion. The room and its chat
  // history stay exactly as they are; see the WS handler's read-only
  // guard in app.ts for what actually stops working once closed.
  router.delete("/:id", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    let room: DomainRoom;
    try {
      room = await domainApi.getRoom(c.req.param("id"));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }
    if (room.host_id !== user.id) return c.json({ error: "forbidden" }, 403);

    try {
      const accepted = await domainApi.deleteRoom(room.id, user.id);
      return c.json(accepted, 202);
    } catch (err) {
      if (err instanceof DomainApiError && err.status === 400) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  return router;
}
