import { useEffect, useRef, useState } from "react";
import { classroomApi } from "./classroomApi.js";

export type ChatMessage = { id: string; userId: string; userName: string; body: string; createdAt: string };
export type Participant = { userId: string; userName: string };

type ClassSocketState = {
  connected: boolean;
  status: string;
  hostId: string | null;
  you: { userId: string; userName: string } | null;
  participants: Participant[];
  chatHistory: ChatMessage[];
  notepad: string;
  // The host's live screen/camera: whether a share is running, and
  // the most recent frame as a JPEG data URL. See useLiveShare.ts for
  // why this is a frame stream rather than WebRTC.
  sharing: boolean;
  frame: string | null;
};

const initialState: ClassSocketState = {
  connected: false,
  status: "open",
  hostId: null,
  you: null,
  participants: [],
  chatHistory: [],
  notepad: "",
  sharing: false,
  frame: null,
};

export function useClassSocket(roomId: string) {
  const [state, setState] = useState<ClassSocketState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);

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
            sharing: Boolean(msg.sharing),
            frame: (msg.lastFrame as string | null) ?? null,
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

        case "share:start":
          setState((s) => ({ ...s, sharing: true }));
          break;

        case "share:stop":
          setState((s) => ({ ...s, sharing: false, frame: null }));
          break;

        case "frame":
          setState((s) => ({ ...s, sharing: true, frame: msg.data as string }));
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
    // Host-only server-side; the capture popup listens for the
    // resulting broadcast and closes itself. See useLiveShare.ts.
    stopShare: () => send({ type: "share:stop" }),
  };
}
