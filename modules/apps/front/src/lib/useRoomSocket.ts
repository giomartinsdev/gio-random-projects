import { useEffect, useRef, useState } from "react";
import { bookclubApi } from "./bookclubApi.js";

export type ChatMessage = { id: string; userId: string; userName: string; body: string; createdAt: string };
export type Cursor = { userId: string; userName: string; x: number; y: number };
export type Stroke = { points: [number, number][]; color: string };
export type Participant = { userId: string; userName: string };

type RoomSocketState = {
  connected: boolean;
  page: number;
  hostId: string | null;
  you: { userId: string; userName: string } | null;
  participants: Participant[];
  chatHistory: ChatMessage[];
  strokes: Stroke[];
  cursors: Record<string, Cursor>;
};

const initialState: RoomSocketState = {
  connected: false,
  page: 1,
  hostId: null,
  you: null,
  participants: [],
  chatHistory: [],
  strokes: [],
  cursors: {},
};

// Cursor/stroke coordinates travel as fractions (0..1) of the PDF
// page's own rendered size, not raw pixels -- every participant's
// viewport can be a different width, and a fraction is the one
// coordinate space every client can consistently scale back up on
// its own <canvas> overlay (see pages/BookClubRoom.tsx).
export function useRoomSocket(roomId: string) {
  const [state, setState] = useState<RoomSocketState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setState(initialState);
    const ws = new WebSocket(bookclubApi.wsUrl(roomId));
    wsRef.current = ws;

    ws.onopen = () => setState((s) => ({ ...s, connected: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data) as Record<string, unknown>;

      switch (msg.type) {
        case "init":
          setState((s) => ({
            ...s,
            page: msg.page as number,
            hostId: msg.hostId as string,
            you: msg.you as RoomSocketState["you"],
            participants: msg.participants as Participant[],
            chatHistory: msg.chatHistory as ChatMessage[],
            strokes: msg.drawing as Stroke[],
          }));
          break;

        case "participant:join": {
          const p = { userId: msg.userId as string, userName: msg.userName as string };
          setState((s) => ({ ...s, participants: [...s.participants.filter((x) => x.userId !== p.userId), p] }));
          break;
        }

        case "participant:leave":
          setState((s) => {
            const cursors = { ...s.cursors };
            delete cursors[msg.userId as string];
            return { ...s, participants: s.participants.filter((p) => p.userId !== msg.userId), cursors };
          });
          break;

        case "chat:message":
          setState((s) => ({ ...s, chatHistory: [...s.chatHistory, msg as unknown as ChatMessage] }));
          break;

        case "page:changed":
          setState((s) => ({ ...s, page: msg.page as number, strokes: [] }));
          break;

        case "cursor:update": {
          const c = { userId: msg.userId as string, userName: msg.userName as string, x: msg.x as number, y: msg.y as number };
          setState((s) => ({ ...s, cursors: { ...s.cursors, [c.userId]: c } }));
          break;
        }

        case "draw:stroke":
          setState((s) => ({
            ...s,
            strokes: [...s.strokes, { points: msg.points as [number, number][], color: msg.color as string }],
          }));
          break;

        case "draw:clear":
          setState((s) => ({ ...s, strokes: [] }));
          break;
      }
    };

    return () => ws.close();
  }, [roomId]);

  function send(payload: unknown) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload));
  }

  return {
    ...state,
    sendChat: (body: string) => send({ type: "chat:send", body }),
    setPage: (page: number) => send({ type: "page:set", page }),
    sendCursor: (x: number, y: number) => send({ type: "cursor:move", x, y }),
    sendStroke: (points: [number, number][], color: string) => send({ type: "draw:stroke", points, color }),
    clearDrawing: () => send({ type: "draw:clear" }),
  };
}
