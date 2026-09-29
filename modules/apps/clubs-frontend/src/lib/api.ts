// Cliente da clubs-api. Toda leitura passa por aqui — nenhuma tela fala com
// o domínio diretamente, e o payload já chega sem termo técnico (ver types.ts).

import type {
  AdminStatus,
  Announcement,
  BestByPosition,
  Club,
  ClubDeltas,
  ClubIdle,
  ClubRef,
  ClaimedPro,
  DivisionChange,
  Evolution,
  FetchRun,
  HeadToHead,
  GlobalRecords,
  HubReport,
  MainRival,
  Match,
  NotificationPrefs,
  PlayerClubTenure,
  PlayerConsistency,
  PlayerDiscipline,
  PlayerEventBreakdown,
  PlayerProfile,
  PlayerRatingEvolution,
  PositionHeatmap,
  PublicProfile,
  RankPlayer,
  Records,
  RegionCount,
  RollingGoals,
  SearchRun,
  SeasonList,
  SourceStatus,
  SquadComparison,
  SquadMember,
  SyncRun,
  TeamOfWeek,
  TimelineEntry,
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

const realApi = {
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
    request<{ started: boolean }>(`/clubs/${encodeURIComponent(clubId)}/fetch-run`, {
      method: "POST",
    }),

  /** O estado do sync de um jogador. A fonte não tem endpoint de jogador -- o
   * dado dele vem das partidas dos clubes onde jogou. */
  fetchRunJogador: (playerId: string) =>
    request<FetchRun>(`/players/${encodeURIComponent(playerId)}/fetch-run`),

  /** Pede o sync de um jogador (atualiza as partidas dos clubes dele). */
  requestFetchJogador: (playerId: string) =>
    request<{ started: boolean }>(`/players/${encodeURIComponent(playerId)}/fetch-run`, {
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
    request<{ started: boolean }>("/clubs/search-live", {
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

  /** A linha do tempo do clube -- divisões, recordes e marcos num fio datado.
   * É o acervo do hub, que a fonte não tem. */
  timeline: (clubId: string) =>
    request<{ eventos: TimelineEntry[]; total: number }>(`/clubs/${encodeURIComponent(clubId)}/timeline`),

  /** A mudança desde a primeira leitura guardada: "o que aconteceu com o meu
   * clube desde que comecei a acompanhar". */
  deltas: (clubId: string) => request<ClubDeltas>(`/clubs/${encodeURIComponent(clubId)}/deltas`),

  // --- analytics do acervo (derivadas do histórico) ----------------------

  seasons: (clubId: string) =>
    request<SeasonList>(`/clubs/${encodeURIComponent(clubId)}/seasons`),

  positionHeatmap: (clubId: string) =>
    request<PositionHeatmap>(`/clubs/${encodeURIComponent(clubId)}/positions`),

  squadComparison: (clubId: string) =>
    request<SquadComparison>(`/clubs/${encodeURIComponent(clubId)}/squad-comparison`),

  rollingGoals: (clubId: string, limite = 20) =>
    request<RollingGoals>(`/clubs/${encodeURIComponent(clubId)}/rolling-goals?limite=${limite}`),

  mainRival: (clubId: string) =>
    request<{ rival: MainRival | null }>(`/clubs/${encodeURIComponent(clubId)}/main-rival`),

  idle: (clubId: string) =>
    request<ClubIdle>(`/clubs/${encodeURIComponent(clubId)}/idle`),

  teamOfWeek: (clubId: string, dias = 7) =>
    request<TeamOfWeek>(`/clubs/${encodeURIComponent(clubId)}/team-of-week?dias=${dias}`),

  bestByPosition: (clubId: string) =>
    request<{ posicoes: BestByPosition[]; total: number }>(
      `/clubs/${encodeURIComponent(clubId)}/best-by-position`,
    ),

  regions: () => request<{ regioes: RegionCount[]; total: number }>("/regions"),

  hubReport: () => request<HubReport>("/hub/report"),

  /** Perfil público (opt-in) pelo handle. Público: não exige login. */
  publicProfile: (handle: string) =>
    request<PublicProfile>(`/profiles/${encodeURIComponent(handle)}`),

  ratingEvolution: (playerId: string) =>
    request<PlayerRatingEvolution>(`/players/${encodeURIComponent(playerId)}/rating-evolution`),

  consistency: (playerId: string) =>
    request<PlayerConsistency>(`/players/${encodeURIComponent(playerId)}/consistency`),

  discipline: (playerId: string) =>
    request<PlayerDiscipline>(`/players/${encodeURIComponent(playerId)}/discipline`),

  tenures: (playerId: string) =>
    request<{ clubes: PlayerClubTenure[]; total: number }>(
      `/players/${encodeURIComponent(playerId)}/tenures`,
    ),

  playerEvents: (playerId: string) =>
    request<PlayerEventBreakdown>(`/players/${encodeURIComponent(playerId)}/events`),

  globalRecords: () => request<GlobalRecords>("/records/global"),

  h2h: (clubId: string, rivalId: string) =>
    request<HeadToHead>(`/clubs/${encodeURIComponent(clubId)}/h2h/${encodeURIComponent(rivalId)}`),

  rankingClubs: (metric = "skill_rating", limite = 10, offset = 0) =>
    request<{ metric: string; clubs: ClubRef[]; total: number }>(
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

  /** A saúde da fonte (EA/CDN). Público: qualquer tela avisa que há
   * dificuldade de falar com a fornecedora dos dados, e quando ela volta o
   * dado sincroniza sozinho. */
  sourceStatus: () => request<SourceStatus>("/source-status"),

  // --- pessoal (exige login) ---------------------------------------------

  me: () => request<{ email: string; autenticado: boolean; is_admin?: boolean }>("/me"),

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
    request<{ started: boolean }>("/sync", { method: "POST", body: JSON.stringify({}) }),

  // --- administração ------------------------------------------------------

  adminStatus: () => request<AdminStatus>("/admin/status"),
};

// O modo demo troca o cliente inteiro por dados locais. A flag é de build
// (VITE_* é inline), então uma tela nunca precisa saber qual está ativo — e o
// bundle de produção do app real nem inclui o mock quando a flag está off,
// porque o import fica atrás do `if`.
//
// Por que existe: o app real depende da EA (que bloqueia o IP do datacenter) e
// de Postgres + worker. Um ambiente de demonstração que depende dessa cadeia
// não demonstra nada -- ele quebra junto. Com a flag, o mesmo SPA roda com dado
// determinístico, sem rede e sem banco.
const DEMO = import.meta.env.VITE_CLUBS_DEMO === "1";

// O import é ESTÁTICO de propósito: `await import()` exigiria top-level await,
// que a config de build não aceita, e o Vite faz tree-shaking por flag --
// quando `VITE_CLUBS_DEMO` é "0", o mock sai do bundle.
import { mockApi } from "./mock-api";

export const api: typeof realApi = DEMO ? mockApi : realApi;
