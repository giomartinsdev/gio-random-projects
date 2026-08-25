import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Auth } from "./lib/auth.js";
import { DomainApiError, NotFoundError, type DomainApiClient, type DomainMessage } from "./lib/domainApiClient.js";
import { createRoomsRouter, sessionRequestHeaders } from "./routes/rooms.js";
import { createRateLimiter } from "./lib/rateLimiter.js";
import { docsHtml, openApiYaml } from "./lib/openapi.js";
import * as roomHub from "./ws/roomHub.js";

const NOTEPAD_MAX = 20_000;

function serializeMessage(m: DomainMessage) {
  return {
    id: m.id,
    userId: m.user_id,
    userName: m.user_name,
    body: m.body,
    createdAt: m.created_at,
  };
}

export function createApp(auth: Auth, domainApi: DomainApiClient, frontendOrigins: string[]) {
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

  // A JSON/WS API with no first-party HTML to protect from framing or
  // inline-script injection -- same reasoning as bookclub-api/post-api's
  // own copy of this line.
  app.use("*", secureHeaders());

  app.use("/rooms/*", createRateLimiter({ requestsPerMinute: 60, burst: 100 }));

  // Hono's own default for an uncaught exception is a bare 500
  // "Internal Server Error" with no body -- fine for a genuine bug,
  // useless for the actual common case here: domain-api being
  // unreachable or rejecting this service's own API key, which is an
  // operational fact worth surfacing (502, with the real message), not
  // an unhandled crash. NotFoundError is deliberately excluded: every
  // route that can hit it already catches it locally for a proper 404.
  app.onError((err, c) => {
    if (err instanceof DomainApiError) {
      console.error("[classroom-api] domain-api call failed:", err.message);
      return c.json({ error: "upstream domain-api call failed" }, 502);
    }
    console.error("[classroom-api] unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  app.route("/rooms", createRoomsRouter(auth, domainApi));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public -- no auth, same reasoning as the other services' own docs
  // routes: documentation, not data.
  app.get("/openapi.yaml", (c) => c.text(openApiYaml, 200, { "content-type": "application/yaml" }));
  app.get("/docs", (c) => c.html(docsHtml));

  // One SSE connection to domain-api PER ROOM (not per participant),
  // kept open for as long as at least one WebSocket client is in that
  // room -- relays domain-worker's message.created event (chat,
  // applied asynchronously through the CQRS pipeline) into this
  // service's own WS broadcast protocol. Unlike bookclub-api, there's
  // no room.updated case to handle here: nothing in a class room ever
  // calls UpdateRoom (no page turns), so that event never fires for a
  // room this service created. Reconnects with a short backoff on
  // drop; stops entirely once the room empties out. See domain-api's
  // internal/infrastructure/http/sse.go for the other half.
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
          if (eventName !== "message.created") return;
          const payload = JSON.parse(data) as Record<string, unknown>;
          roomHub.broadcast(roomId, {
            type: "chat:message",
            id: payload.message_id,
            userId: payload.user_id,
            userName: payload.user_name,
            body: payload.body,
            createdAt: payload.occurred_at,
          });
        });
      } catch {
        // network hiccup or domain-api restart -- fall through to the
        // backoff below and try again, unless we were aborted (room emptied).
      }
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Realtime channel for one class: chat, a shared notepad, and
  // WebRTC signaling for the host's shared screen/camera. The host is
  // the ONE media source -- each viewer opens its own peer connection
  // directly to the host (a mesh with the host at the center), so this
  // server never touches media itself, only relays opaque signaling
  // payloads (offer/answer/ICE) between exactly two participants by
  // userId (see ws/roomHub.ts's sendTo). Fine for a small class; an
  // SFU would be the next step if this ever needs to scale past a
  // handful of simultaneous viewers.
  app.get(
    "/rooms/:id/ws",
    upgradeWebSocket(async (c) => {
      const roomId = c.req.param("id");
      if (!roomId) {
        return { onOpen: (_evt, ws) => ws.close(1008, "room not found") };
      }

      const session = await auth.api.getSession({ headers: sessionRequestHeaders(c.req.raw) });
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
              status: room.status,
              hostId,
              you: { userId, userName },
              participants: roomHub.participantsOf(roomId),
              chatHistory: messages.map(serializeMessage),
              notepad: roomHub.notepadOf(roomId),
            }),
          );
          // Lets the host (and any already-connected viewer) know a
          // new participant showed up -- the host's client reacts by
          // opening a new peer connection and sending it an offer (see
          // front's useClassSocket.ts).
          roomHub.broadcast(roomId, { type: "participant:join", userId, userName }, ws);
        },

        onMessage: async (evt, ws) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(evt.data));
          } catch {
            return;
          }

          // A closed room ("Encerrar aula") stays viewable -- the
          // `init` payload already sent on open still carries chat
          // history, status, and the notepad's last content -- but
          // goes read-only: no new chat, notepad edits, or WebRTC
          // signaling (nothing to broadcast to anyway, the host is
          // long gone). Same convention as bookclub-api's own guard.
          if (room.status === "closed") return;

          switch (msg.type) {
            case "chat:send": {
              const body = typeof msg.body === "string" ? msg.body.trim().slice(0, 2000) : "";
              if (!body) return;
              await domainApi.createMessage({ room_id: roomId, user_id: userId, user_name: userName, body });
              break;
            }

            case "notepad:update": {
              const content = typeof msg.content === "string" ? msg.content.slice(0, NOTEPAD_MAX) : "";
              roomHub.setNotepad(roomId, content);
              // Excludes the sender: it already has the value it just
              // typed locally, echoing it back would fight the local
              // cursor position.
              roomHub.broadcast(roomId, { type: "notepad:update", content }, ws);
              break;
            }

            // Opaque relay -- this server has no idea what an SDP
            // offer/answer or an ICE candidate even looks like, it
            // just forwards `payload` to the participant named by
            // `to`, tagging it with who it's actually from (never
            // trust a client-supplied "from"). Every WebRTC semantic
            // lives entirely in front's useClassSocket.ts/AulaRoom.tsx.
            case "webrtc:signal": {
              const to = typeof msg.to === "string" ? msg.to : "";
              if (!to || !("payload" in msg)) return;
              roomHub.sendTo(roomId, to, { type: "webrtc:signal", from: userId, payload: msg.payload });
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
