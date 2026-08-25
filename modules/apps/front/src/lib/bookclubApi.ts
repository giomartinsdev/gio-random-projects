import { getDiscordBearerToken } from "./discordAuthToken.js";

const BASE_URL = import.meta.env.VITE_BOOKCLUB_API_URL as string;
const WS_BASE_URL = BASE_URL.replace(/^http/, "ws");

export type Room = {
  id: string;
  title: string;
  hostId: string;
  documentId: string;
  currentPage: number;
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
  deleteRoom: (id: string) => request<void>(`/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
