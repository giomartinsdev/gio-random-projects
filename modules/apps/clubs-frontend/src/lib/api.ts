// Cliente da clubs-api. Toda leitura passa por aqui — nenhuma tela fala com
// o domínio diretamente, e o payload já chega sem termo técnico (ver types.ts).

import type {
  AdminStatus,
  Announcement,
  Club,
  ClaimedPro,
  DivisionChange,
  Evolution,
  FetchRun,
  HeadToHead,
  Match,
  NotificationPrefs,
  PlayerProfile,
  RankPlayer,
  Records,
  SearchRun,
  SquadMember,
  SyncRun,
  WatchEntry,
} from "./types";

// Em produção o build grava a URL absoluta da API (VITE_CLUBS_API_URL); em
// dev o proxy do Vite resolve "/api" para o clubs-api local, então o default
// relativo funciona nos dois casos.
const BASE = import.meta.env.VITE_CLUBS_API_URL ?? "";

/** URL absoluta de um caminho da API. Usado pelo fluxo de login, que precisa
 * montar a URL fora do wrapper de request. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

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
    request<{ clubs: Club[]; total: number }>(`/clubs${onlyFollowed ? "?acompanhados=1" : ""}`),

  searchClubs: (q: string) =>
    request<{ clubs: Club[]; total: number; termo: string }>(`/clubs/search?q=${encodeURIComponent(q)}`),

  club: (clubId: string) => request<Club>(`/clubs/${encodeURIComponent(clubId)}`),

  squad: (clubId: string) =>
    request<{ players: SquadMember[]; total: number }>(`/clubs/${encodeURIComponent(clubId)}/squad`),

  /** O estado do fetch sob demanda do elenco. A tela de resgate polla isto
   * depois de pedir, para saber quando mostrar os jogadores. */
  fetchRun: (clubId: string) =>
    request<FetchRun>(`/clubs/${encodeURIComponent(clubId)}/fetch-run`),

  /** Pede o sync sob demanda do elenco de um clube. Público de propósito: a
   * pessoa escolhe o clube antes de entrar. A resposta é 202 -- a busca é em
   * segundo plano. */
  requestFetch: (clubId: string) =>
    request<{ iniciado: boolean }>(`/clubs/${encodeURIComponent(clubId)}/fetch-run`, {
      method: "POST",
    }),

  /** O estado do sync de um jogador. A fonte não tem endpoint de jogador -- o
   * dado dele vem das partidas dos clubes onde jogou. */
  fetchRunJogador: (playerId: string) =>
    request<FetchRun>(`/players/${encodeURIComponent(playerId)}/fetch-run`),

  /** Pede o sync de um jogador (atualiza as partidas dos clubes dele). */
  requestFetchJogador: (playerId: string) =>
    request<{ iniciado: boolean }>(`/players/${encodeURIComponent(playerId)}/fetch-run`, {
      method: "POST",
    }),

  // --- busca ao vivo (a normal é local) ----------------------------------
  //
  // A busca local só conhece o que o hub já viu. Para quem chega com um clube
  // novo, ela devolve vazio e a pessoa conclui que a tela está quebrada. Estas
  // duas chamadas são o caminho que vai na fonte.

  searchLiveStatus: (termo: string) =>
    request<SearchRun>(`/clubs/search-live?termo=${encodeURIComponent(termo)}`),

  requestSearchLive: (termo: string) =>
    request<{ iniciado: boolean }>("/clubs/search-live", {
      method: "POST",
      body: JSON.stringify({ termo }),
    }),

  matches: (clubId: string, kind = "", limite = 25) =>
    request<{ matches: Match[]; total: number }>(
      `/clubs/${encodeURIComponent(clubId)}/matches?kind=${encodeURIComponent(kind)}&limite=${limite}`,
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

  rankingClubs: (metric = "skill_rating", limite = 10, offset = 0) =>
    request<{ metric: string; clubs: Club[]; total: number }>(
      `/rankings/clubs?metric=${encodeURIComponent(metric)}&limite=${limite}&offset=${offset}`,
    ),

  rankingPlayers: (metric = "rating", limite = 10, offset = 0, position = "") =>
    request<{ metric: string; players: RankPlayer[]; total: number }>(
      `/rankings/players?metric=${encodeURIComponent(metric)}&limite=${limite}&offset=${offset}&position=${encodeURIComponent(position)}`,
    ),

  players: (q = "", limite = 60) =>
    request<{ players: PlayerProfile[]; total: number; termo: string }>(
      `/players?q=${encodeURIComponent(q)}&limite=${limite}`,
    ),

  /** O tamanho do índice cross-club, sem trazer a página: o total que o
   * cabeçalho da home mostra. Pede 1 registro só para ler o `total`, que é o
   * índice inteiro, não a página. */
  playerCount: () =>
    request<{ players: PlayerProfile[]; total: number; termo: string }>(
      "/players?limite=1",
    ).then((r) => r.total ?? 0),

  player: (playerId: string) =>
    request<PlayerProfile>(`/players/${encodeURIComponent(playerId)}`),

  announcements: (limite = 12) =>
    request<{ announcements: Announcement[]; total: number }>(`/announcements?limite=${limite}`),

  // --- pessoal (exige login) ---------------------------------------------

  me: () => request<{ email: string; autenticado: boolean }>("/me"),

  watchlist: () => request<{ clubs: WatchEntry[]; total: number }>("/watchlist"),

  setWatch: (clubId: string, seguindo: boolean, source = "manual") =>
    request<{ club_id: string; seguindo: boolean }>("/watchlist", {
      method: "POST",
      body: JSON.stringify({ club_id: clubId, seguindo, source }),
    }),

  notifications: () => request<NotificationPrefs>("/notifications"),

  saveNotifications: (prefs: NotificationPrefs) =>
    request<{ ok: boolean }>("/notifications", { method: "POST", body: JSON.stringify(prefs) }),

  claimedPro: () => request<{ pro: ClaimedPro | null }>("/claimed-pro"),

  claimPro: (clubId: string, playerId: string) =>
    request<{ player_id: string; verified: boolean }>("/claimed-pro", {
      method: "POST",
      body: JSON.stringify({ club_id: clubId, player_id: playerId }),
    }),

  syncStatus: () => request<SyncRun>("/sync/status"),

  startSync: () =>
    request<{ iniciado: boolean }>("/sync", { method: "POST", body: JSON.stringify({}) }),

  // --- administração ------------------------------------------------------

  adminStatus: () => request<AdminStatus>("/admin/status"),
};
