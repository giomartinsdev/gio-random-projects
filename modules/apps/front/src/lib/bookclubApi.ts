import { getDiscordBearerToken } from "./discordAuthToken.js";

const BASE_URL = import.meta.env.VITE_BOOKCLUB_API_URL as string;
const WS_BASE_URL = BASE_URL.replace(/^http/, "ws");

export type Room = {
  id: string;
  title: string;
  hostId: string;
  documentId: string;
  currentPage: number;
  // "open" | "paused" | "closed" -- a closed room ("Encerrar sala")
  // stays in this list and stays viewable (PDF, past chat) forever,
  // it just stops accepting page turns/drawings/new chat. See
  // domain-worker's room.go for the authoritative status values.
  status: string;
  createdAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const bearer = getDiscordBearerToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const bookclubApi = {
  listRooms: () => request<{ rooms: Room[] }>("/rooms"),
  getRoom: (id: string) => request<Room>(`/rooms/${encodeURIComponent(id)}`),
  createRoom: (title: string, pdf: File) => {
    const form = new FormData();
    form.set("title", title);
    form.set("pdf", pdf);
    return request<Room>("/rooms", { method: "POST", body: form });
  },
  // Named for what it actually does now: a soft close (status ->
  // "closed"), not a deletion -- the room, its PDF, and its chat
  // history all survive. Still a DELETE on the wire (bookclub-api's
  // route/verb didn't change, only its behavior).
  closeRoom: (id: string) => request<void>(`/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // ?token= fallback: neither a plain <fetch> for PDF bytes nor the
  // browser WebSocket API can carry a custom Authorization header --
  // see bookclub-api's sessionRequestHeaders (routes/rooms.ts) for the
  // server-side half of this. Omitted entirely outside a Discord
  // Activity (cookies already cover it there).
  pdfUrl: (id: string) => {
    const bearer = getDiscordBearerToken();
    const suffix = bearer ? `?token=${encodeURIComponent(bearer)}` : "";
    return `${BASE_URL}/rooms/${encodeURIComponent(id)}/pdf${suffix}`;
  },
  wsUrl: (id: string) => {
    const bearer = getDiscordBearerToken();
    const suffix = bearer ? `?token=${encodeURIComponent(bearer)}` : "";
    return `${WS_BASE_URL}/rooms/${encodeURIComponent(id)}/ws${suffix}`;
  },
};
