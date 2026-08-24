import type { WSContext } from "hono/ws";

// In-memory, single-process room state -- deliberately not Redis-backed
// pub/sub like domain-api/domain-worker's command bus. This repo
// deploys one container per service (no horizontal scaling of any app
// here), so "every connected socket is in this same process" always
// holds; if that stops being true, this is the file that'd need a
// shared broadcast layer.
type Participant = {
  ws: WSContext;
  userId: string;
  userName: string;
};

type Stroke = { points: [number, number][]; color: string };

type RoomState = {
  participants: Map<WSContext, Participant>;
  // Current PAGE's pen strokes only -- cleared on every page turn (see
  // app.ts's "page:set" handler). Not persisted to Postgres: this is
  // meant as "point at something on this page right now", not a
  // permanent annotation record.
  drawing: Stroke[];
};

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { participants: new Map(), drawing: [] };
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

export function participantsOf(roomId: string) {
  const room = rooms.get(roomId);
  return room ? [...room.participants.values()].map((p) => ({ userId: p.userId, userName: p.userName })) : [];
}

export function addStroke(roomId: string, stroke: Stroke) {
  const room = getOrCreateRoom(roomId);
  room.drawing.push(stroke);
  if (room.drawing.length > 500) room.drawing.shift();
}

export function clearDrawing(roomId: string) {
  const room = rooms.get(roomId);
  if (room) room.drawing = [];
}

export function drawingOf(roomId: string): Stroke[] {
  return rooms.get(roomId)?.drawing ?? [];
}
