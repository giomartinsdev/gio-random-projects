// The Go server serves this bundle, so everything is same-origin --
// no base URL, no CORS, no tokens beyond the room's own.
export type CreatedRoom = { roomId: string; hostToken: string };
export type RoomStatus = { roomId: string; sharing: boolean; watching: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `falha na requisição (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  createRoom: (password: string) =>
    request<CreatedRoom>("/api/rooms", { method: "POST", body: JSON.stringify({ password }) }),

  getRoom: (roomId: string) => request<RoomStatus>(`/api/rooms/${encodeURIComponent(roomId)}`),

  checkPassword: (roomId: string, password: string) =>
    request<{ ok: boolean; sharing: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}/check`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
};

export function wsUrl(params: Record<string, string>): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const qs = new URLSearchParams(params).toString();
  return `${proto}//${window.location.host}/ws?${qs}`;
}

// The host token is what proves you're the one sharing, so it lives in
// sessionStorage: it survives a reload of the room page but not the
// tab closing, and never ends up in a link someone could paste.
const hostTokenKey = (roomId: string) => `tela:host:${roomId}`;

export function rememberHostToken(roomId: string, token: string) {
  try {
    sessionStorage.setItem(hostTokenKey(roomId), token);
  } catch {
    // Private mode with storage disabled -- the share still works for
    // this page load, it just won't survive a reload.
  }
}

export function readHostToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(hostTokenKey(roomId));
  } catch {
    return null;
  }
}

export function forgetHostToken(roomId: string) {
  try {
    sessionStorage.removeItem(hostTokenKey(roomId));
  } catch {
    // nothing to do
  }
}
