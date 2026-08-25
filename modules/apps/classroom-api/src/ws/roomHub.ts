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
  // Whether the host is currently sharing, and the most recent frame
  // (a base64 JPEG data URL). Both go out in `init` so someone joining
  // mid-class sees the screen immediately instead of a blank panel
  // until the next frame lands. Never persisted, same as the notepad.
  sharing: boolean;
  lastFrame: string | null;
};

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { participants: new Map(), notepad: "", sharing: false, lastFrame: null };
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

export function setSharing(roomId: string, sharing: boolean) {
  const room = getOrCreateRoom(roomId);
  room.sharing = sharing;
  if (!sharing) room.lastFrame = null;
}

export function setLastFrame(roomId: string, frame: string) {
  getOrCreateRoom(roomId).lastFrame = frame;
}

export function shareStateOf(roomId: string) {
  const room = rooms.get(roomId);
  return { sharing: room?.sharing ?? false, lastFrame: room?.lastFrame ?? null };
}
