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

export type Stroke = { points: [number, number][]; color: string };
export type TextAnnotation = { id: string; x: number; y: number; text: string; color: string; fontSize: number };

type RoomState = {
  participants: Map<WSContext, Participant>;
  // Current PAGE's annotations only -- both cleared on every page turn
  // (see app.ts's "page:set" handler) or an explicit "clear" from the
  // host. Not persisted to Postgres: this is meant as "point at
  // something on this page right now", not a permanent record.
  drawing: Stroke[];
  texts: TextAnnotation[];
};

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { participants: new Map(), drawing: [], texts: [] };
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

export function addText(roomId: string, text: TextAnnotation) {
  const room = getOrCreateRoom(roomId);
  room.texts.push(text);
  if (room.texts.length > 200) room.texts.shift();
}

// Move/resize both mutate the SAME annotation object callers already
// hold a reference to via previous addText/broadcast calls, but we
// look it up by id here rather than trust a client-supplied object --
// the id is the only thing a "text:move"/"text:resize" message can
// legitimately claim to be about.
export function moveText(roomId: string, id: string, x: number, y: number): boolean {
  const t = rooms.get(roomId)?.texts.find((t) => t.id === id);
  if (!t) return false;
  t.x = x;
  t.y = y;
  return true;
}

export function resizeText(roomId: string, id: string, fontSize: number): boolean {
  const t = rooms.get(roomId)?.texts.find((t) => t.id === id);
  if (!t) return false;
  t.fontSize = fontSize;
  return true;
}

export function removeText(roomId: string, id: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const before = room.texts.length;
  room.texts = room.texts.filter((t) => t.id !== id);
  return room.texts.length !== before;
}

export function clearAnnotations(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    room.drawing = [];
    room.texts = [];
  }
}

export function drawingOf(roomId: string): Stroke[] {
  return rooms.get(roomId)?.drawing ?? [];
}

export function textsOf(roomId: string): TextAnnotation[] {
  return rooms.get(roomId)?.texts ?? [];
}
