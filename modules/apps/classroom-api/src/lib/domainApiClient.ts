// classroom-api owns no room/message storage of its own -- everything
// (Room, Message) goes through domain-api's generic CQRS pipeline,
// same contract bookclub-api's own client gets against the SAME
// aggregates (Room doesn't know or care whether DocumentID is a real
// PDF id or, as here, always ""). streamRoomEvents is a hand-rolled
// SSE reader (no `eventsource` package -- Node's global fetch +
// ReadableStream is enough), because this needs a custom X-API-Key
// header a browser's native EventSource can't send. See app.ts's
// WebSocket handler for how those events get translated into this
// service's own realtime wire protocol.
export type RoomStatus = "open" | "paused" | "closed";

export type DomainRoom = {
  id: string;
  host_id: string;
  title: string;
  document_id: string;
  // "book" (bookclub-api) or "class" (this service) -- partitions the
  // one shared Room aggregate. See listRooms/createRoom below.
  kind: string;
  current_page: number;
  status: RoomStatus;
  created_at: string;
  updated_at: string;
};

export type DomainMessage = {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  body: string;
  requested_page: number | null;
  created_at: string;
};

export type Accepted = { command_id: string; status: "accepted" };

export class DomainApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainApiError {
  constructor() {
    super(404, "not found");
  }
}

export function createDomainApiClient(baseUrl: string, apiKey: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, "content-type": "application/json", "x-api-key": apiKey },
    });
    if (res.status === 404) throw new NotFoundError();
    if (!res.ok) {
      const body = await res.text();
      throw new DomainApiError(res.status, `domain-api ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    // domain-api's /rooms has no server-side kind filter -- it's one
    // shared aggregate, bookclub-api's rooms included in the same
    // response. Filtered here so this service never lists (or, via
    // getRoom below, operates on) a room that isn't actually one of
    // its own classes.
    listRooms: async () => {
      const { rooms } = await request<{ rooms: DomainRoom[] }>("/rooms");
      return { rooms: rooms.filter((r) => r.kind === "class") };
    },
    getRoom: async (id: string) => {
      const room = await request<DomainRoom>(`/rooms/${encodeURIComponent(id)}`);
      if (room.kind !== "class") throw new NotFoundError();
      return room;
    },
    // document_id always "" -- a live class has no document, only a
    // shared screen/camera and a notepad, neither of which domain-api
    // knows anything about (see ws/roomHub.ts).
    createRoom: (input: { host_id: string; title: string }) =>
      request<Accepted>("/rooms", { method: "POST", body: JSON.stringify({ ...input, document_id: "", kind: "class" }) }),
    deleteRoom: (id: string, hostId: string) =>
      request<Accepted>(`/rooms/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ host_id: hostId }),
      }),

    listMessages: (roomId: string) =>
      request<{ messages: DomainMessage[] }>(`/messages?room_id=${encodeURIComponent(roomId)}`),
    createMessage: (input: { room_id: string; user_id: string; user_name: string; body: string }) =>
      request<Accepted>("/messages", { method: "POST", body: JSON.stringify(input) }),

    // Reads the room's SSE stream until `signal` aborts. onEvent fires
    // once per "event: <name>\ndata: <json>\n\n" frame. Reconnection on
    // an unexpected drop is the caller's job (app.ts retries with a
    // short backoff) -- this function itself just runs one connection
    // to completion or abort.
    async streamRoomEvents(roomId: string, signal: AbortSignal, onEvent: (eventName: string, data: string) => void) {
      const res = await fetch(`${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`, {
        headers: { "x-api-key": apiKey },
        signal,
      });
      if (!res.ok || !res.body) {
        throw new DomainApiError(res.status, `domain-api sse ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          let sepIndex: number;
          while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);

            let eventName = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7);
              else if (line.startsWith("data: ")) data = line.slice(6);
            }
            if (data) onEvent(eventName, data);
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export type DomainApiClient = ReturnType<typeof createDomainApiClient>;
