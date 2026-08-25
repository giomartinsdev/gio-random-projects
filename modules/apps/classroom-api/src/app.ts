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
// One base64 JPEG frame. SharePopup caps capture at 1280px wide and
// quality 0.5, which lands well under this even on a busy screen --
// this is the "something is wrong, don't relay it to everyone" bound,
// not the expected size.
const FRAME_MAX = 900_000;

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
      // 502/504/52x are Cloudflare's own reserved "gateway" range --
      // it silently REPLACES the origin's response body for those
      // exact codes with its own generic text, discarding whatever
      // JSON this returns (confirmed the hard way debugging post-api's
      // /image-proxy earlier). 500 isn't in that special-cased set, so
      // it's what actually reaches the caller with this message intact.
      return c.json({ error: `upstream domain-api call failed: ${err.message}` }, 500);
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

  // Realtime channel for one class: chat, a shared notepad, and the
  // host's shared screen/camera as a JPEG frame stream. The host is
  // the ONE media source and every frame is fanned out from here.
  //
  // This started as WebRTC signaling (host->viewer mesh, server never
  // touching media). That can't work in the target environment: inside
  // a Discord Activity's iframe RTCPeerConnection is not a
  // constructor, so neither sending nor receiving peer-to-peer video
  // is possible. Frames over this socket use only what the Activity
  // does allow. The tradeoff is real -- a few frames per second and
  // no audio track (class audio rides Discord's own voice channel) --
  // and relaying media through one process puts a ceiling on class
  // size that a real SFU wouldn't have.
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
              ...roomHub.shareStateOf(roomId),
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

            // Screen/camera share, as a stream of JPEG frames rather
            // than WebRTC: inside a Discord Activity's iframe
            // RTCPeerConnection isn't even a constructor (Discord
            // removes it), so peer-to-peer video is impossible there
            // in BOTH directions. WebSocket + canvas are allowed,
            // hence this. See front's pages/SharePopup.tsx for the
            // capture/encode half.
            //
            // Only the host may drive any of this -- a viewer sending
            // these is ignored outright rather than errored, same
            // permissive-ignore convention as the malformed-message
            // cases above.
            case "share:start":
            case "share:stop": {
              if (userId !== hostId) return;
              roomHub.setSharing(roomId, msg.type === "share:start");
              roomHub.broadcast(roomId, { type: msg.type }, ws);
              break;
            }

            case "frame": {
              if (userId !== hostId) return;
              const data = typeof msg.data === "string" ? msg.data : "";
              // Oversized frames are dropped, not truncated: half a
              // JPEG renders as nothing useful anyway, and the next
              // frame is only ~500ms out.
              if (!data || data.length > FRAME_MAX) return;
              roomHub.setLastFrame(roomId, data);
              roomHub.broadcast(roomId, { type: "frame", data }, ws);
              break;
            }
          }
        },

        onClose: (_evt, ws) => {
          roomHub.leave(roomId, ws);
          // Only announce a leave once EVERY connection for this
          // userId is gone -- the host is legitimately connected
          // twice while sharing (this Activity tab, plus the
          // screen/camera capture popup, see SharePopup.tsx), and a
          // naive per-socket leave broadcast here would tell every
          // viewer "the host left" the instant they stop sharing.
          const stillPresent = roomHub.participantsOf(roomId).some((p) => p.userId === userId);
          if (!stillPresent) {
            roomHub.broadcast(roomId, { type: "participant:leave", userId });
            // The host closing the capture popup (or the whole tab)
            // ends the share -- without this the panel would sit on
            // its last frame forever, looking live but frozen.
            if (userId === hostId) {
              roomHub.setSharing(roomId, false);
              roomHub.broadcast(roomId, { type: "share:stop" });
            }
          }
          stopRoomSubscriptionIfEmpty(roomId);
        },
      };
    }),
  );

  return { app, injectWebSocket };
}

export type App = ReturnType<typeof createApp>["app"];
