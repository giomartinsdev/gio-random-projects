// cch-api is a separate origin (its own container, its own hostname)
// -- VITE_CCH_API_URL is baked in at build time (see vite.config.ts)
// and empty locally, where the dev server's own proxy
// (vite.config.ts) makes relative paths reach cch-api anyway.
const API_URL = import.meta.env.VITE_CCH_API_URL ?? "";

export type CreatedRoom = { roomId: string };
export type RoomStatus = { roomId: string; people: number; playing: boolean };
export type RoomSummary = { roomId: string; people: number; playing: boolean; createdAt: string };
export type KnockStatus = { status: "pending" | "approved" | "denied"; admitToken?: string };

// Metadata only -- never the cards themselves, which only reach a
// player through the deal (see the Go side's handleDecks).
export type DeckInfo = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  whites: number;
  blacks: number;
};

// ---- Forja de Decks (AI generation + marketplace) ----

// A marketplace listing: same shape as a built-in deck's info plus who
// forged it and how much it's been played.
export type CustomDeckInfo = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  parentId?: string;
  author?: string;
  whites: number;
  blacks: number;
  createdAt: string;
  plays: number;
};

// The full deck, cards included -- only for the forge's editor/fork
// flow, never for browsing.
export type CustomDeck = CustomDeckInfo & {
  whites: string[];
  blacks: string[];
};

// What the AI returns: a draft the editor takes as a starting point.
export type DeckDraft = {
  name: string;
  emoji: string;
  description: string;
  whites: string[];
  blacks: string[];
};

export type AIStatus = { configured: boolean; model: string };

// The same "custom" marker the lobby chips use: custom decks live in
// the same picker as built-ins, just badged.
export const CUSTOM_DECK_PREFIX = "cx";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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

  // Salas rolando agora -- the home page's "join something already
  // happening" list. Only rooms with someone in them come back; see
  // the Go side's Registry.Active.
  listRooms: () => request<RoomSummary[]>("/api/rooms"),

  checkPassword: (roomId: string, password: string) =>
    request<{ ok: boolean; people: number }>(`/api/rooms/${encodeURIComponent(roomId)}/check`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  // Asks to enter without the password -- everyone already in the room
  // gets notified over their own WebSocket (see useGame's
  // knockRequests) and can approve or deny it from there.
  knock: (roomId: string, name: string) =>
    request<{ requestId: string }>(`/api/rooms/${encodeURIComponent(roomId)}/knock`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // Polled rather than held open -- a slow or unattended room must
  // never freeze the requester's own tab. See KnockLobby in Room.tsx.
  knockStatus: (roomId: string, requestId: string) =>
    request<KnockStatus>(`/api/rooms/${encodeURIComponent(roomId)}/knock/${encodeURIComponent(requestId)}`),

  // Delete a room -- only the creator (who knows the password) can do
  // this. Used by the "adm" shortcut in Room.tsx.
  deleteRoom: (roomId: string, password: string) =>
    request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      body: JSON.stringify({ password }),
    }),

  listDecks: () => request<DeckInfo[]>("/api/decks"),

  // ---- Forja ----

  // Whether this server has an AI writer behind the forge.
  aiStatus: () => request<AIStatus>("/api/ai/status"),

  // Drafts a themed deck from an existing one. Not saved anywhere --
  // the editor refines it before publishing. Generations take tens of
  // seconds; the server holds the request until the writer answers.
  generateDeck: (parentDeckId: string, theme: string) =>
    request<{ draft: DeckDraft }>("/api/decks/generate", {
      method: "POST",
      body: JSON.stringify({ parentDeckId, theme }),
    }),

  // Publishes the refined deck to the marketplace. The server mints
  // the id; the response carries it.
  publishDeck: (deck: {
    name: string;
    emoji: string;
    description: string;
    parentId?: string;
    author?: string;
    whites: string[];
    blacks: string[];
  }) => request<CustomDeck>("/api/decks/custom", { method: "POST", body: JSON.stringify(deck) }),

  // Marketplace: metadata only.
  listCustomDecks: () => request<CustomDeckInfo[]>("/api/decks/custom"),

  // Full deck with cards -- the "open in the forge and fork it" flow.
  getCustomDeck: (id: string) => request<CustomDeck>(`/api/decks/custom/${encodeURIComponent(id)}`),
};

// A marketplace deck chosen to play with next: stashed here by the
// marketplace's "jogar" button and consumed by the room lobby's
// initial deck selection (and Home's create form).
const presetDeckKey = "cch:presetDeck";

export function rememberPresetDeck(deckId: string) {
  try {
    sessionStorage.setItem(presetDeckKey, deckId);
  } catch {
    // Storage disabled: the preset just doesn't carry over.
  }
}

export function takePresetDeck(): string | null {
  try {
    const v = sessionStorage.getItem(presetDeckKey);
    sessionStorage.removeItem(presetDeckKey);
    return v;
  } catch {
    return null;
  }
}

export function peekPresetDeck(): string | null {
  try {
    return sessionStorage.getItem(presetDeckKey);
  } catch {
    return null;
  }
}

export function wsUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (API_URL) {
    // Absolute VITE_CCH_API_URL, e.g. https://cch-api.giomartins.dev
    // -- swap the scheme for its ws(s) equivalent.
    const wsBase = API_URL.replace(/^http/, "ws");
    return `${wsBase}/ws?${qs}`;
  }
  // No API_URL configured (local dev): same-origin, relying on
  // vite.config.ts's own /ws proxy.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?${qs}`;
}

// The identity the server issued for this room, kept so a reconnect can
// reclaim it instead of coming back as a stranger (see useGame). It
// lives in sessionStorage: it must survive a reload and a server
// restart, but it's meaningless in another tab and shouldn't outlive
// the tab that owns it.
export type Identity = { peerId: string; name: string; resume: string };

const identityKey = (roomId: string) => `cch:id:${roomId}`;

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