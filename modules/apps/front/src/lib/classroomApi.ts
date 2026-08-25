import { getDiscordBearerToken } from "./discordAuthToken.js";

const BASE_URL = import.meta.env.VITE_CLASSROOM_API_URL as string;
const WS_BASE_URL = BASE_URL.replace(/^http/, "ws");

export type Room = {
  id: string;
  title: string;
  hostId: string;
  // "open" | "paused" | "closed" -- a closed room ("Encerrar aula")
  // stays in this list and its chat stays readable forever, it just
  // stops accepting new chat/notepad edits/video. See domain-worker's
  // room.go for the authoritative status values.
  status: string;
  createdAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const bearer = getDiscordBearerToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const classroomApi = {
  listRooms: () => request<{ rooms: Room[] }>("/rooms"),
  getRoom: (id: string) => request<Room>(`/rooms/${encodeURIComponent(id)}`),
  createRoom: (title: string) => request<Room>("/rooms", { method: "POST", body: JSON.stringify({ title }) }),
  // Named for what it actually does: a soft close (status ->
  // "closed"), not a deletion -- the room and its chat history
  // survive. Still a DELETE on the wire.
  closeRoom: (id: string) => request<void>(`/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // ?token= fallback: the browser WebSocket API can't carry a custom
  // Authorization header -- see classroom-api's sessionRequestHeaders
  // (routes/rooms.ts) for the server-side half of this. Omitted
  // entirely outside a Discord Activity (cookies already cover it
  // there).
  wsUrl: (id: string) => {
    const bearer = getDiscordBearerToken();
    const suffix = bearer ? `?token=${encodeURIComponent(bearer)}` : "";
    return `${WS_BASE_URL}/rooms/${encodeURIComponent(id)}/ws${suffix}`;
  },
};
