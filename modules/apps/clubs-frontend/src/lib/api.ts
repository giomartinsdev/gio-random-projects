// Cliente da clubs-api. Toda leitura passa por aqui — nenhuma tela fala com
// o domínio diretamente, e o payload já chega sem termo técnico (ver types.ts).

import type {
  AdminStatus,
  Announcement,
  Club,
  ClaimedPro,
  DivisionChange,
  Evolution,
  HeadToHead,
  Match,
  NotificationPrefs,
  PlayerProfile,
  RankPlayer,
  Records,
  SquadMember,
  SyncRun,
  WatchEntry,
} from "./types";

// Em produção o build grava a URL absoluta da API (VITE_CLUBS_API_URL); em
// dev o proxy do Vite resolve "/api" para o clubs-api local, então o default
// relativo funciona nos dois casos.
const BASE = import.meta.env.VITE_CLUBS_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // 401 é o caminho esperado do probe de login, não uma falha.
    throw new ApiError(`request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- público --------------------------------------------------------------

export const api = {
  clubs: (onlyFollowed = false) =>
    request<{ clubes: Club[]; total: number }>(`/clubs${onlyFollowed ? "?acompanhados=1" : ""}`),

  searchClubs: (q: string) =>
    request<{ clubes: Club[]; total: number; termo: string }>(`/clubs/search?q=${encodeURIComponent(q)}`),

  club: (clubId: string) => request<Club>(`/clubs/${encodeURIComponent(clubId)}`),

  squad: (clubId: string) =>
    request<{ jogadores: SquadMember[]; total: number }>(`/clubs/${encodeURIComponent(clubId)}/squad`),

  matches: (clubId: string, tipo = "", limite = 25) =>
    request<{ partidas: Match[]; total: number }>(
      `/clubs/${encodeURIComponent(clubId)}/matches?tipo=${encodeURIComponent(tipo)}&limite=${limite}`,
    ),

  match: (matchId: string) => request<Match>(`/matches/${encodeURIComponent(matchId)}`),

  evolution: (clubId: string) =>
    request<Evolution>(`/clubs/${encodeURIComponent(clubId)}/evolution`),

  divisionChanges: (clubId: string) =>
    request<{ mudancas: DivisionChange[]; total: number }>(
      `/clubs/${encodeURIComponent(clubId)}/division-changes`,
    ),

  records: (clubId: string) => request<Records>(`/clubs/${encodeURIComponent(clubId)}/records`),

  h2h: (clubId: string, rivalId: string) =>
    request<HeadToHead>(`/clubs/${encodeURIComponent(clubId)}/h2h/${encodeURIComponent(rivalId)}`),

  rankingClubs: (metrica = "nivel") =>
    request<{ metrica: string; clubes: Club[]; total: number }>(
      `/rankings/clubs?metrica=${encodeURIComponent(metrica)}`,
    ),

  rankingPlayers: (metrica = "nota", posicao = "") =>
    request<{ metrica: string; jogadores: RankPlayer[]; total: number }>(
      `/rankings/players?metrica=${encodeURIComponent(metrica)}&posicao=${encodeURIComponent(posicao)}`,
    ),

  players: (q = "", limite = 60) =>
    request<{ jogadores: PlayerProfile[]; total: number; termo: string }>(
      `/players?q=${encodeURIComponent(q)}&limite=${limite}`,
    ),

  player: (playerId: string) =>
    request<PlayerProfile>(`/players/${encodeURIComponent(playerId)}`),

  announcements: () =>
    request<{ anuncios: Announcement[]; total: number }>("/announcements"),

  // --- pessoal (exige login) ---------------------------------------------

  me: () => request<{ email: string; autenticado: boolean }>("/me"),

  watchlist: () => request<{ clubes: WatchEntry[]; total: number }>("/watchlist"),

  setWatch: (clubId: string, seguindo: boolean, origem = "manual") =>
    request<{ club_id: string; seguindo: boolean }>("/watchlist", {
      method: "POST",
      body: JSON.stringify({ club_id: clubId, seguindo, origem }),
    }),

  notifications: () => request<NotificationPrefs>("/notifications"),

  saveNotifications: (prefs: NotificationPrefs) =>
    request<{ ok: boolean }>("/notifications", { method: "POST", body: JSON.stringify(prefs) }),

  claimedPro: () => request<{ pro: ClaimedPro | null }>("/claimed-pro"),

  claimPro: (clubId: string, playerId: string) =>
    request<{ player_id: string; verificado: boolean }>("/claimed-pro", {
      method: "POST",
      body: JSON.stringify({ club_id: clubId, player_id: playerId }),
    }),

  syncStatus: () => request<SyncRun>("/sync/status"),

  startSync: () =>
    request<{ iniciado: boolean }>("/sync", { method: "POST", body: JSON.stringify({}) }),

  // --- administração ------------------------------------------------------

  adminStatus: () => request<AdminStatus>("/admin/status"),
};
