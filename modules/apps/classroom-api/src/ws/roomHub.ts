import type { WSContext } from "hono/ws";

// In-memory, single-process room state -- deliberately not Redis-backed
// pub/sub like domain-api/domain-worker's command bus. This repo
// deploys one container per service (no horizontal scaling of any app
// here), so "every connected socket is in this same process" always
// holds; if that stops being true, this is the file that'd need a
// shared broadcast layer. Same pattern as bookclub-api's own
// ws/roomHub.ts, adapted for a class instead of a book: no
// page/drawing state, a shared notepad instead, and per-participant
// WebRTC signaling relay for the host's shared screen/camera.
type Participant = {
  ws: WSContext;
  userId: string;
  userName: string;
};

type RoomState = {
  participants: Map<WSContext, Participant>;
  // Last-write-wins shared text, never persisted (same "point at
  // something right now, not a permanent record" reasoning as
  // bookclub-api's drawing/texts) -- included in the WS `init` payload
  // so a client joining mid-class sees the current content immediately.
  notepad: string;
};

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { participants: new Map(), notepad: "" };
    rooms.set(roomId, room);
  }
  return room;
}

export function broadcast(roomId: string, payload: unknown, exclude?: WSContext) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const [ws] of room.participants) {
    if (ws === exclude) continue;
    try {
      ws.send(data);
    } catch {
      // best-effort -- a dead socket gets cleaned up by its own onClose
    }
  }
}

// Targeted delivery for WebRTC signaling (offer/answer/ICE candidates
// are between exactly two participants, never everyone) -- looks the
// recipient up by userId rather than trusting a client-supplied
// WSContext, same "only trust what the server itself tracked"
// reasoning as text:move/resize below in bookclub-api's own hub.
//
// Delivers to EVERY connection open under that userId, not just the
// first -- the same person can legitimately be connected twice at
// once (the host's own Activity tab plus the screen/camera capture
// popup useWebRTCBroadcast.ts opens for them, see SharePopup.tsx).
// Both sides tag their payloads with a relayId + role so each ignores
// the echo of its own messages that this fans out to it as well.
export function sendTo(roomId: string, userId: string, payload: unknown): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const data = JSON.stringify(payload);
  let delivered = false;
  for (const [ws, p] of room.participants) {
    if (p.userId !== userId) continue;
    try {
      ws.send(data);
    } catch {
      // best-effort, same as broadcast
    }
    delivered = true;
  }
  return delivered;
}

export function join(roomId: string, ws: WSContext, userId: string, userName: string) {
  getOrCreateRoom(roomId).participants.set(ws, { ws, userId, userName });
}

export function leave(roomId: string, ws: WSContext) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.participants.delete(ws);
  if (room.participants.size === 0) rooms.delete(roomId);
}

// Deduped by userId, not connection count -- the same person can be
// connected twice at once (see sendTo's comment above), and every
// caller of this (the `init` payload, the room-empty check) cares
// about distinct people, not distinct sockets.
export function participantsOf(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const seen = new Map<string, { userId: string; userName: string }>();
  for (const p of room.participants.values()) {
    if (!seen.has(p.userId)) seen.set(p.userId, { userId: p.userId, userName: p.userName });
  }
  return [...seen.values()];
}

export function setNotepad(roomId: string, content: string) {
  getOrCreateRoom(roomId).notepad = content;
}

export function notepadOf(roomId: string): string {
  return rooms.get(roomId)?.notepad ?? "";
}
