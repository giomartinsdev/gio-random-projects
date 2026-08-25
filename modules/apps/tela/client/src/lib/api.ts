// The Go server serves this bundle, so everything is same-origin --
// no base URL, no CORS, no tokens beyond the room's own.
export type CreatedRoom = { roomId: string };
export type RoomStatus = { roomId: string; people: number; publishing: number };

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
    request<{ ok: boolean; people: number }>(`/api/rooms/${encodeURIComponent(roomId)}/check`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
};

export function wsUrl(params: Record<string, string>): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const qs = new URLSearchParams(params).toString();
  return `${proto}//${window.location.host}/ws?${qs}`;
}

// The identity the server issued for this room, kept so a reconnect can
// reclaim it instead of coming back as a stranger (see useRoom). It
// lives in sessionStorage: it must survive a reload and a server
// restart, but it's meaningless in another tab and shouldn't outlive
// the tab that owns it.
export type Identity = { peerId: string; name: string; resume: string };

const identityKey = (roomId: string) => `tela:id:${roomId}`;

export function rememberIdentity(roomId: string, identity: Identity) {
  try {
    sessionStorage.setItem(identityKey(roomId), JSON.stringify(identity));
  } catch {
    // Storage disabled (private mode). Reconnects still work, they just
    // come back with a fresh identity.
  }
}

export function readIdentity(roomId: string): Identity | null {
  try {
    const raw = sessionStorage.getItem(identityKey(roomId));
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}
