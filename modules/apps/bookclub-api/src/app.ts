import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import { asc, eq } from "drizzle-orm";
import type { Auth } from "./lib/auth.js";
import type { Db } from "./db/index.js";
import { bookclubMessage, bookclubRoom } from "./db/schema.js";
import { createRoomsRouter } from "./routes/rooms.js";
import * as roomHub from "./ws/roomHub.js";

function serializeMessage(m: typeof bookclubMessage.$inferSelect) {
  return {
    id: m.id,
    userId: m.userId,
    userName: m.userName,
    body: m.body,
    requestedPage: m.requestedPage,
    createdAt: m.createdAt,
  };
}

export function createApp(auth: Auth, db: Db, frontendOrigins: string[]) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.use(
    "*",
    cors({
      origin: frontendOrigins,
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
    }),
  );

  app.route("/rooms", createRoomsRouter(auth, db));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Realtime channel for one room: page turns, live cursors/laser
  // pointer, host pen strokes and text annotations, chat (including
  // "can we go to page N?" requests) -- see ws/roomHub.ts for the
  // in-memory broadcast side and this repo's other -api services for
  // why persistence (rooms/documents/messages) stays direct Postgres
  // here rather than going through domain-api's async command
  // pipeline: that pipeline is built for simple entity CRUD with
  // eventual consistency, not a live socket that needs to read "who's
  // the host" and "what page are we on" synchronously on every single
  // message.
  app.get(
    "/rooms/:id/ws",
    upgradeWebSocket(async (c) => {
      const roomId = c.req.param("id");
      if (!roomId) {
        return { onOpen: (_evt, ws) => ws.close(1008, "room not found") };
      }

      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      const [room] = session ? await db.select().from(bookclubRoom).where(eq(bookclubRoom.id, roomId)) : [];

      if (!session || !room) {
        return { onOpen: (_evt, ws) => ws.close(1008, session ? "room not found" : "unauthorized") };
      }

      const userId = session.user.id;
      const userName = session.user.name;
      const hostId = room.hostId;

      return {
        onOpen: async (_evt, ws) => {
          roomHub.join(roomId, ws, userId, userName);

          const history = await db
            .select()
            .from(bookclubMessage)
            .where(eq(bookclubMessage.roomId, roomId))
            .orderBy(asc(bookclubMessage.createdAt))
            .limit(200);

          ws.send(
            JSON.stringify({
              type: "init",
              page: room.currentPage,
              hostId,
              you: { userId, userName },
              participants: roomHub.participantsOf(roomId),
              chatHistory: history.map(serializeMessage),
              drawing: roomHub.drawingOf(roomId),
              texts: roomHub.textsOf(roomId),
            }),
          );
          roomHub.broadcast(roomId, { type: "participant:join", userId, userName }, ws);
        },

        onMessage: async (evt, ws) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(evt.data));
          } catch {
            return;
          }

          switch (msg.type) {
            case "chat:send": {
              const body = typeof msg.body === "string" ? msg.body.trim().slice(0, 2000) : "";
              const requestedPageRaw = Number(msg.requestedPage);
              const requestedPage = Number.isInteger(requestedPageRaw) && requestedPageRaw > 0 ? requestedPageRaw : null;
              if (!body) return;
              const row = { id: randomUUID(), roomId, userId, userName, body, requestedPage, createdAt: new Date() };
              await db.insert(bookclubMessage).values(row);
              roomHub.broadcast(roomId, { type: "chat:message", ...serializeMessage(row) });
              break;
            }

            case "page:set": {
              if (userId !== hostId) return;
              const page = Number(msg.page);
              if (!Number.isFinite(page) || page < 1) return;
              await db.update(bookclubRoom).set({ currentPage: page, updatedAt: new Date() }).where(eq(bookclubRoom.id, roomId));
              roomHub.clearAnnotations(roomId);
              roomHub.broadcast(roomId, { type: "page:changed", page });
              break;
            }

            case "cursor:move": {
              const x = Number(msg.x);
              const y = Number(msg.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return;
              const style = msg.style === "laser" ? "laser" : "normal";
              roomHub.broadcast(roomId, { type: "cursor:update", userId, userName, x, y, style }, ws);
              break;
            }

            case "draw:stroke": {
              if (userId !== hostId) return;
              if (!Array.isArray(msg.points)) return;
              const stroke = {
                points: msg.points as [number, number][],
                color: typeof msg.color === "string" ? msg.color : "#F5A623",
              };
              roomHub.addStroke(roomId, stroke);
              // No `exclude: ws` here (unlike cursor:move) -- the
              // host's own client never appends a stroke to its local
              // state on send, only on receiving this broadcast back.
              // Excluding the sender would make their own just-drawn
              // stroke vanish the instant they lift the pen.
              roomHub.broadcast(roomId, { type: "draw:stroke", ...stroke });
              break;
            }

            case "text:add": {
              if (userId !== hostId) return;
              const x = Number(msg.x);
              const y = Number(msg.y);
              const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 280) : "";
              if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return;
              const annotation = {
                id: randomUUID(),
                x,
                y,
                text,
                color: typeof msg.color === "string" ? msg.color : "#F5A623",
              };
              roomHub.addText(roomId, annotation);
              roomHub.broadcast(roomId, { type: "text:add", ...annotation });
              break;
            }

            case "draw:clear": {
              if (userId !== hostId) return;
              roomHub.clearAnnotations(roomId);
              roomHub.broadcast(roomId, { type: "draw:clear" });
              break;
            }
          }
        },

        onClose: (_evt, ws) => {
          roomHub.leave(roomId, ws);
          roomHub.broadcast(roomId, { type: "participant:leave", userId });
        },
      };
    }),
  );

  return { app, injectWebSocket };
}

export type App = ReturnType<typeof createApp>["app"];
