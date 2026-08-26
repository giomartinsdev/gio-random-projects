import { useEffect, useRef, useState } from "react";
import { classroomApi } from "./classroomApi.js";

export type ChatMessage = { id: string; userId: string; userName: string; body: string; createdAt: string };
export type Participant = { userId: string; userName: string };
export type SignalPayload = Record<string, unknown>;

type ClassSocketState = {
  connected: boolean;
  status: string;
  hostId: string | null;
  you: { userId: string; userName: string } | null;
  participants: Participant[];
  chatHistory: ChatMessage[];
  notepad: string;
};

const initialState: ClassSocketState = {
  connected: false,
  status: "open",
  hostId: null,
  you: null,
  participants: [],
  chatHistory: [],
  notepad: "",
};

// onSignal fires for every incoming webrtc:signal message, outside
// React state -- AulaRoom.tsx's WebRTC peer-connection logic (offers,
// answers, ICE candidates) needs to react to these immediately, not
// wait on a render cycle the way reading them back out of state would.
export function useClassSocket(roomId: string, onSignal: (from: string, payload: SignalPayload) => void) {
  const [state, setState] = useState<ClassSocketState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    setState(initialState);
    const ws = new WebSocket(classroomApi.wsUrl(roomId));
    wsRef.current = ws;

    ws.onopen = () => setState((s) => ({ ...s, connected: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data) as Record<string, unknown>;

      switch (msg.type) {
        case "init":
          setState((s) => ({
            ...s,
            status: (msg.status as string) ?? "open",
            hostId: msg.hostId as string,
            you: msg.you as ClassSocketState["you"],
            participants: msg.participants as Participant[],
            chatHistory: msg.chatHistory as ChatMessage[],
            notepad: (msg.notepad as string) ?? "",
          }));
          break;

        case "participant:join": {
          const p = { userId: msg.userId as string, userName: msg.userName as string };
          setState((s) => ({ ...s, participants: [...s.participants.filter((x) => x.userId !== p.userId), p] }));
          break;
        }

        case "participant:leave":
          setState((s) => ({ ...s, participants: s.participants.filter((p) => p.userId !== msg.userId) }));
          break;

        case "chat:message":
          setState((s) => ({ ...s, chatHistory: [...s.chatHistory, msg as unknown as ChatMessage] }));
          break;

        case "notepad:update":
          setState((s) => ({ ...s, notepad: (msg.content as string) ?? "" }));
          break;

        case "webrtc:signal":
          onSignalRef.current(msg.from as string, msg.payload as SignalPayload);
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
    updateNotepad: (content: string) => send({ type: "notepad:update", content }),
    sendSignal: (to: string, payload: SignalPayload) => send({ type: "webrtc:signal", to, payload }),
  };
}
