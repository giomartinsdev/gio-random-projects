import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Auth } from "./lib/auth.js";
import type { Db } from "./db/index.js";
import type { MinioClient } from "./lib/minioClient.js";
import { NotFoundError, type DomainApiClient, type DomainMessage } from "./lib/domainApiClient.js";
import { createRoomsRouter } from "./routes/rooms.js";
import * as roomHub from "./ws/roomHub.js";

function serializeMessage(m: DomainMessage) {
  return {
    id: m.id,
    userId: m.user_id,
    userName: m.user_name,
    body: m.body,
    requestedPage: m.requested_page,
    createdAt: m.created_at,
  };
}

export function createApp(auth: Auth, db: Db, domainApi: DomainApiClient, minio: MinioClient, frontendOrigins: string[]) {
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

  app.route("/rooms", createRoomsRouter(auth, db, domainApi, minio));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // One SSE connection to domain-api PER ROOM (not per participant),
  // kept open for as long as at least one WebSocket client is in that
  // room -- relays domain-worker's room.updated/message.created events
  // (room/chat state, applied asynchronously through the CQRS
  // pipeline) into this service's own existing WS broadcast protocol.
  // Reconnects with a short backoff on drop; stops entirely once the
  // room empties out. See domain-api's internal/infrastructure/http/sse.go
  // for the other half.
  const roomSubscriptions = new Map<string, AbortController>();

  function ensureRoomSubscription(roomId: string) {
    if (roomSubscriptions.has(roomId)) return;
    const controller = new AbortController();
    roomSubscriptions.set(roomId, controller);
    runRoomSubscription(roomId, controller.signal);
  }

  function stopRoomSubscriptionIfEmpty(roomId: string) {
    if (roomHub.participantsOf(roomId).length > 0) return;
    roomSubscriptions.get(roomId)?.abort();
    roomSubscriptions.delete(roomId);
  }

  async function runRoomSubscription(roomId: string, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        await domainApi.streamRoomEvents(roomId, signal, (eventName, data) => {
          const payload = JSON.parse(data) as Record<string, unknown>;
          switch (eventName) {
            case "room.updated":
              // room.updated fires on every page turn (see the
              // "page:set" WS handler below) -- clearing annotations
              // here, driven by the SAME event, keeps every connected
              // client in lockstep instead of racing an immediate
              // local clear against this async echo.
              roomHub.clearAnnotations(roomId);
              roomHub.broadcast(roomId, {
                type: "page:changed",
                page: payload.current_page as number,
                status: payload.status as string,
              });
              break;

            case "message.created":
              roomHub.broadcast(roomId, {
                type: "chat:message",
                id: payload.message_id,
                userId: payload.user_id,
                userName: payload.user_name,
                body: payload.body,
                requestedPage: payload.requested_page ?? null,
                createdAt: payload.occurred_at,
              });
              break;
          }
        });
      } catch {
        // network hiccup or domain-api restart -- fall through to the
        // backoff below and try again, unless we were aborted (room emptied).
      }
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Realtime channel for one room: page turns, live cursors/laser
  // pointer, host pen strokes and text annotations, chat (including
  // "can we go to page N?" requests). Cursors/strokes/texts are
  // ephemeral and stay entirely local to this process (never touch
  // domain-api -- see ws/roomHub.ts). Page turns and chat go through
  // domain-api's Room/Message aggregates and come back over the SSE
  // relay above, not as an immediate local broadcast -- see that
  // function's own comment for why.
  app.get(
    "/rooms/:id/ws",
    upgradeWebSocket(async (c) => {
      const roomId = c.req.param("id");
      if (!roomId) {
        return { onOpen: (_evt, ws) => ws.close(1008, "room not found") };
      }

      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      let room;
      if (session) {
        try {
          room = await domainApi.getRoom(roomId);
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      }

      if (!session || !room) {
        return { onOpen: (_evt, ws) => ws.close(1008, session ? "room not found" : "unauthorized") };
      }

      const userId = session.user.id;
      const userName = session.user.name;
      const hostId = room.host_id;

      return {
        onOpen: async (_evt, ws) => {
          roomHub.join(roomId, ws, userId, userName);
          ensureRoomSubscription(roomId);

          const { messages } = await domainApi.listMessages(roomId);

          ws.send(
            JSON.stringify({
              type: "init",
              page: room.current_page,
              status: room.status,
              hostId,
              you: { userId, userName },
              participants: roomHub.participantsOf(roomId),
              chatHistory: messages.map(serializeMessage),
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
              const requestedPage = Number.isInteger(requestedPageRaw) && requestedPageRaw > 0 ? requestedPageRaw : undefined;
              if (!body) return;
              await domainApi.createMessage({ room_id: roomId, user_id: userId, user_name: userName, body, requested_page: requestedPage });
              break;
            }

            case "page:set": {
              if (userId !== hostId) return;
              const page = Number(msg.page);
              if (!Number.isFinite(page) || page < 1) return;
              await domainApi.updateRoom(roomId, { host_id: hostId, current_page: page });
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
              roomHub.broadcast(roomId, { type: "draw:stroke", ...stroke });
              break;
            }

            case "text:add": {
              if (userId !== hostId) return;
              const x = Number(msg.x);
              const y = Number(msg.y);
              const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 280) : "";
              const fontSizeRaw = Number(msg.fontSize);
              const fontSize = Number.isFinite(fontSizeRaw) ? Math.min(48, Math.max(10, fontSizeRaw)) : 16;
              if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return;
              const annotation = {
                id: crypto.randomUUID(),
                x,
                y,
                text,
                fontSize,
                color: typeof msg.color === "string" ? msg.color : "#F5A623",
              };
              roomHub.addText(roomId, annotation);
              roomHub.broadcast(roomId, { type: "text:add", ...annotation });
              break;
            }

            // Drag-to-move and a font-size stepper for one already-placed
            // annotation -- the host-only counterpart to the plain
            // "add and never touch again" flow above.
            case "text:move": {
              if (userId !== hostId) return;
              const id = typeof msg.id === "string" ? msg.id : "";
              const x = Number(msg.x);
              const y = Number(msg.y);
              if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;
              if (!roomHub.moveText(roomId, id, x, y)) return;
              roomHub.broadcast(roomId, { type: "text:move", id, x, y });
              break;
            }

            case "text:resize": {
              if (userId !== hostId) return;
              const id = typeof msg.id === "string" ? msg.id : "";
              const fontSizeRaw = Number(msg.fontSize);
              if (!id || !Number.isFinite(fontSizeRaw)) return;
              const fontSize = Math.min(48, Math.max(10, fontSizeRaw));
              if (!roomHub.resizeText(roomId, id, fontSize)) return;
              roomHub.broadcast(roomId, { type: "text:resize", id, fontSize });
              break;
            }

            case "text:remove": {
              if (userId !== hostId) return;
              const id = typeof msg.id === "string" ? msg.id : "";
              if (!id) return;
              if (!roomHub.removeText(roomId, id)) return;
              roomHub.broadcast(roomId, { type: "text:remove", id });
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
          stopRoomSubscriptionIfEmpty(roomId);
        },
      };
    }),
  );

  return { app, injectWebSocket };
}

export type App = ReturnType<typeof createApp>["app"];
