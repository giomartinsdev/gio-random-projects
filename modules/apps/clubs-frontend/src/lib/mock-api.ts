// O cliente do demo: mesma superfície do `api` real, servida de dados locais.
//
// A troca é feita em um lugar só (`api.ts` decide qual exportar), então
// nenhuma tela sabe se está falando com a rede ou com o mock. Um demo que
// depende do backend real (Postgres + worker + o CDN da EA que bloqueia o IP
// do datacenter) não é demo -- quebra junto com a cadeia que ele demonstra.

import { ApiError } from "./api";
import * as D from "./mock-data";
import type {
  AdminStatus,
  Club,
  ClaimedPro,
  DivisionChange,
  Evolution,
  FetchRun,
  HeadToHead,
  Match,
  NotificationPrefs,
  Records,
  SearchRun,
  SquadMember,
  SyncRun,
  WatchEntry,
} from "./types";

/** Devolve depois de um tick, para o demo mostrar o estado de carregando em
 * vez de tudo aparecer de uma vez num frame só. */
function later<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// O "usuário" do demo está sempre logado: é o que permite mostrar a Minha Área,
// o resgate e as notificações sem exigir um Google real.
let claimed: ClaimedPro | null = {
  club_id: D.MY_CLUB.club_id,
  // O pro marcado como resgatado no elenco do clube.
  player_id: D.squadOf(D.MY_CLUB.club_id)[3]?.player_id ?? "",
  verified: true,
};

let watch: WatchEntry[] = [...D.WATCHLIST];
let prefs: NotificationPrefs = { ...D.NOTIFICATION_PREFS };

export const mockApi = {
  // --- público ------------------------------------------------------------
  clubs: (onlyFollowed = false) =>
    later<{ clubs: Club[]; total: number }>({
      clubs: onlyFollowed ? D.CLUBS.filter((c) => watch.some((w) => w.club_id === c.club_id)) : D.CLUBS,
      total: onlyFollowed ? watch.length : D.CLUBS.length,
    }),

  searchClubs: (q: string) => {
    const needle = q.trim().toLowerCase();
    // Tolerante a acento: o `normalize` com NFD separa o acento e o `replace`
    // o remove, então "atletico" acha "Atlético".
    const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const found = needle ? D.CLUBS.filter((c) => fold(c.name).includes(fold(needle)) || fold(c.tag).includes(fold(needle))) : [];
    return later<{ clubs: Club[]; total: number; termo: string }>({ clubs: found, total: found.length, termo: q });
  },

  club: (clubId: string) => {
    const c = D.CLUBS.find((x) => x.club_id === clubId);
    if (!c) return Promise.reject(new ApiError("not found", 404));
    return later(c);
  },

  squad: (clubId: string) =>
    later<{ players: SquadMember[]; total: number }>({ players: D.squadOf(clubId), total: D.squadOf(clubId).length }),

  fetchRun: (clubId: string) =>
    later<FetchRun>({ target: "club", target_id: clubId, label: "", running: false, players: D.squadOf(clubId).length, matches: 10, clubs: 1, error: "", finished_at: new Date().toISOString() }),

  requestFetch: (_clubId: string) => later({ started: true }),

  fetchRunJogador: (playerId: string) =>
    later<FetchRun>({ target: "player", target_id: playerId, label: "", running: false, players: 1, matches: 10, clubs: 2, error: "", finished_at: new Date().toISOString() }),

  requestFetchJogador: (_playerId: string) => later({ started: true }),

  searchLiveStatus: (termo: string) =>
    later<SearchRun>({ termo, running: false, found: 0, error: "", finished_at: new Date().toISOString() }),

  requestSearchLive: (_termo: string) => later({ started: true }),

  matches: (clubId: string, _kind = "", limit = 25) =>
    later<{ matches: Match[]; total: number }>({ matches: D.matchesOf(clubId, limit), total: D.matchesOf(clubId, limit).length }),

  match: (matchId: string) => {
    const m = D.MATCHES.find((x) => x.match_id === matchId);
    return m ? later(m) : Promise.reject(new ApiError("not found", 404));
  },

  evolution: (clubId: string) => later<Evolution>(D.evolutionOf(clubId)),

  divisionChanges: (_clubId: string) =>
    later<{ mudancas: DivisionChange[]; total: number }>({ mudancas: D.DIVISION_CHANGES, total: D.DIVISION_CHANGES.length }),

  records: (clubId: string) => later<Records>(D.recordsOf(clubId)),

  h2h: (clubId: string, rivalId: string) => later<HeadToHead>(D.h2h(clubId, rivalId)),

  rankingClubs: (metric = "skill_rating", limit = 10, offset = 0) => {
    const all = D.rankingsClubs(metric);
    return later({ metric, clubs: all.slice(offset, offset + limit), total: all.length });
  },

  rankingPlayers: (metric = "rating", limit = 10, offset = 0, _position = "") => {
    const all = D.rankingsPlayers(metric);
    return later({ metric, players: all.slice(offset, offset + limit), total: all.length });
  },

  players: (q = "", limit = 60) => {
    const needle = q.trim().toLowerCase();
    const found = needle ? D.PLAYERS.filter((p) => p.gamertag.toLowerCase().includes(needle)) : D.PLAYERS;
    return later({ players: found.slice(0, limit), total: found.length, termo: q });
  },

  playerCount: () => later(D.PLAYERS.length),

  player: (playerId: string) => {
    const p = D.playerById(playerId);
    return p ? later(p) : Promise.reject(new ApiError("not found", 404));
  },

  announcements: (limit = 12) => later({ announcements: D.ANNOUNCEMENTS.slice(0, limit), total: D.ANNOUNCEMENTS.length }),

  // --- pessoal (sempre logado no demo) ------------------------------------

  me: () => later<{ email: string; autenticado: boolean }>({ email: "demo@clubs.hub", autenticado: true }),

  watchlist: () => later<{ clubs: WatchEntry[]; total: number }>({ clubs: watch, total: watch.length }),

  setWatch: (clubId: string, seguindo: boolean, source = "manual") => {
    if (seguindo) {
      const c = D.CLUBS.find((x) => x.club_id === clubId);
      if (c && !watch.some((w) => w.club_id === clubId)) {
        watch = [...watch, { club_id: c.club_id, name: c.name, tag: c.tag, division_at_read: c.division, skill_rating: c.skill_rating, tracked_since: new Date().toISOString(), source: source as WatchEntry["source"] }];
      }
    } else {
      watch = watch.filter((w) => w.club_id !== clubId);
    }
    return later({ club_id: clubId, seguindo });
  },

  notifications: () => later<NotificationPrefs>(prefs),
  saveNotifications: (p: NotificationPrefs) => {
    prefs = p;
    return later({ ok: true });
  },

  claimedPro: () => later<{ pro: ClaimedPro | null }>({ pro: claimed }),
  claimPro: (clubId: string, playerId: string) => {
    claimed = { club_id: clubId, player_id: playerId, verified: true };
    return later({ player_id: playerId, verified: true });
  },

  syncStatus: () => later<SyncRun>(D.SYNC_RUN),
  startSync: () => later({ started: true }),

  // --- administração ------------------------------------------------------

  adminStatus: () => later<AdminStatus>(D.ADMIN_STATUS),
};

export type MockApi = typeof mockApi;
