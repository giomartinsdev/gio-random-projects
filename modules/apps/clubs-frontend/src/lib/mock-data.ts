// Dados do demo: um dataset pequeno e realista, servido sem backend.
//
// Por que mockado: o app real depende de Postgres + worker + o CDN da EA, e é
// essa cadeia que quebra (a EA bloqueia o IP do datacenter). Um demo que
// depende dela não é demo. Aqui os dados são gerados uma vez, determinísticos
// (mesma seed = mesma tela), e cobrem todos os estados que a UI desenha:
// clube acompanhado e não acompanhado, elenco cheio, histórico de nível,
// recordes, divisões, anúncios e um pro já resgatado.
//
// O cliente (mock-api.ts) expõe as MESMAS funções do `api` real, então a troca
// é uma linha e nenhuma tela precisa saber que o dado é local.

import type {
  AdminStatus,
  RecordMatch,
  Adversario,
  Announcement,
  BestByPosition,
  Club,
  ClubDeltas,
  ClubIdle,
  ClubRef,
  DivisionChange,
  Evolution,
  GlobalRecordClub,
  GlobalRecords,
  HeadToHead,
  HubReport,
  MainRival,
  Match,
  NotificationPrefs,
  PlayerClubTenure,
  PlayerConsistency,
  PlayerDiscipline,
  PlayerEventBreakdown,
  PlayerLine,
  PlayerProfile,
  PlayerRatingEvolution,
  PlayerSeason,
  Position,
  PositionHeatmap,
  RankPlayer,
  RatingPoint,
  RegionCount,
  Resultado,
  Records,
  RollingGoals,
  SeasonList,
  SeasonScorer,
  SeasonSummary,
  SquadChange,
  SquadComparison,
  SquadMember,
  SyncRun,
  TimelineEntry,
  WatchEntry,
} from "./types";

// Gerador determinístico: sem Math.random, a tela não muda entre reloads.
let seed = 20260922;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function intBetween(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

const NAMES = [
  "Vila Nova FC", "Atlético Central", "Porto Rival", "Real Bairro",
  "Sporting Sul", "Grêmio Norte", "Independente Leste", "Náutico Oeste",
  "União da Serra", "Palmeira Alta", "Cruzeiro do Vale", "Botafogo Jr",
  "Corinthians do Morro", "Estrela Azul", "Racing Oeste", "Tigres FC",
];
const TAGS = ["VNV", "ATC", "PRV", "RLB", "SPS", "GRN", "INL", "NTO", "UDS", "PLA", "CDV", "BTJ", "CDM", "EAZ", "RCO", "TFC"];
const STADIUMS = ["Arena Vila Nova", "Estádio Central", "Cais Arena", "Campo do Bairro", "Arena Sul", "Baixada Norte", "Praça Leste", "Maré Oeste"];
const COLORS: Array<[number, number]> = [
  [0x2fbf71, 0xffffff], [0xd62828, 0x111111], [0x1d4ed8, 0xffffff], [0x7c3aed, 0xf5c542],
  [0x0e2a47, 0x22d3ee], [0x0f766e, 0xf8fafc], [0xea580c, 0x111827], [0xfacc15, 0x15803d],
];

const GAMERTAGS = [
  "ItsPuIga", "LaToff_", "ElyesTM", "Nayiir-X-", "Capone17x", "WvrrenSG",
  "Atsu20-Mats", "G_Wakabayashi", "xGrahham", "Luca-nr1", "YanisFcz",
  "Festik22", "Bxrisha", "FrancioLF", "Kastroo02", "xlsesuxl_",
  "xKizaa", "COD5Adrien", "Thiago_SNK", "Bolt_FC", "MegaPera_9", "Lucas_CB7",
];
const POSITIONS = ["goalkeeper", "defender", "midfielder", "forward"] as const;

function iso(daysAgo: number, hour = 21, minute = 0): string {
  const d = new Date("2026-09-22T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// --- clubes ----------------------------------------------------------------

function makeClub(i: number): Club {
  const [c1, c2] = COLORS[i % COLORS.length];
  const played = intBetween(30, 60);
  const wins = Math.round(played * (0.45 + rnd() * 0.4));
  const draws = intBetween(2, 8);
  const losses = Math.max(0, played - wins - draws);
  const goals = wins * intBetween(3, 6) + intBetween(0, 10);
  const conceded = losses * intBetween(2, 4) + intBetween(0, 8);
  const form = Array.from({ length: 10 }, () => pick(["win", "win", "draw", "loss"]));
  return {
    club_id: String(1001 + i),
    name: NAMES[i % NAMES.length],
    tag: TAGS[i % TAGS.length],
    stadium: STADIUMS[i % STADIUMS.length],
    region_id: "5457237",
    team_id: String(231 + i),
    crest_asset_id: String(99160309 + i),
    color_1: c1,
    color_2: c2,
    color_3: c2,
    color_4: c2,
    tracked: i < 6,
    updated_at: iso(0, 18, intBetween(0, 59)),
    played,
    wins,
    draws,
    losses,
    goals,
    goals_conceded: conceded,
    clean_sheets: Math.max(1, Math.round(wins * 0.45)),
    points: wins * 3 + draws,
    division: i < 3 ? 1 : i < 9 ? 2 : 3,
    best_division: i < 3 ? 1 : 2,
    skill_rating: 2144 - i * intBetween(8, 22),
    promotions: intBetween(0, 5),
    relegations: intBetween(0, 2),
    win_rate: Math.round((wins / played) * 1000) / 10,
    form,
    streak: { wins: intBetween(0, 8), unbeaten: intBetween(0, 11) },
    adversarios: null,
  };
}

export const CLUBS: Club[] = NAMES.map((_, i) => makeClub(i));

// O clube do "usuário" do demo -- é o que a Minha Área mostra como seu.
export const MY_CLUB = CLUBS[0];

// --- elenco ----------------------------------------------------------------

function makeSquad(club: Club, size: number, claimedAt = -1): SquadMember[] {
  const out: SquadMember[] = [];
  for (let i = 0; i < size; i++) {
    const gamertag = GAMERTAGS[(Number(club.club_id) + i) % GAMERTAGS.length];
    const position = POSITIONS[i % POSITIONS.length];
    const played = intBetween(4, 30);
    const goals = position === "forward" ? intBetween(3, 20) : intBetween(0, 6);
    const assists = position === "midfielder" ? intBetween(3, 18) : intBetween(0, 8);
    const rating = Math.round((5.5 + rnd() * 3.5) * 100) / 100;
    out.push({
      player_id: `${club.club_id}${String(100 + i)}`,
      gamertag,
      position,
      played,
      goals,
      assists,
      rating,
      shots: intBetween(2, 60),
      passes_made: intBetween(40, 400),
      passes_attempted: intBetween(50, 480),
      tackles_made: intBetween(5, 90),
      tackles_attempted: intBetween(8, 120),
      saves: position === "goalkeeper" ? intBetween(10, 60) : 0,
      man_of_the_match: intBetween(0, 8),
      seconds_played: played * intBetween(3000, 5500),
      form: Array.from({ length: 8 }, () => Math.round((5 + rnd() * 5) * 10) / 10),
      goals_per_game: Math.round((goals / played) * 100) / 100,
      assists_per_game: Math.round((assists / played) * 100) / 100,
      pass_accuracy: intBetween(60, 92),
      tackle_accuracy: intBetween(15, 60),
      clean_sheets: position === "goalkeeper" ? intBetween(1, 12) : 0,
      red_cards: rnd() > 0.9 ? 1 : 0,
      goalkeeper: position === "goalkeeper",
      saves_by_type:
        position === "goalkeeper"
          ? { ballDiveSaves: intBetween(1, 8), crossSaves: intBetween(0, 5), goodDirectionSaves: intBetween(0, 4), parrySaves: intBetween(0, 6), punchSaves: intBetween(0, 3), reflexSaves: intBetween(1, 9) }
          : null,
      // Um pro de cada elenco já resgatado, para a tela de resgate mostrar os
      // três estados (livre, seu, bloqueado) sem precisar de outro clube.
      resgatado: claimedAt >= 0 && i === claimedAt,
    });
  }
  return out.sort((a, b) => b.rating - a.rating);
}

const SQUADS = new Map<string, SquadMember[]>();
export function squadOf(clubId: string): SquadMember[] {
  if (!SQUADS.has(clubId)) {
    const club = CLUBS.find((c) => c.club_id === clubId) ?? MY_CLUB;
    SQUADS.set(clubId, makeSquad(club, intBetween(12, 20), club.club_id === MY_CLUB.club_id ? 3 : -1));
  }
  return SQUADS.get(clubId)!;
}

// --- partidas --------------------------------------------------------------

let matchSeq = 14800000000000;
export const MATCHES: Match[] = [];
for (const club of CLUBS) {
  const squad = squadOf(club.club_id).slice(0, 10);
  for (let i = 0; i < 10; i++) {
    const opponent = CLUBS[(CLUBS.indexOf(club) + i + 1) % CLUBS.length];
    const our = intBetween(0, 6);
    const their = intBetween(0, 4);
    const result = our > their ? "win" : our < their ? "loss" : "draw";
    const players: PlayerLine[] = squad.map((p) => ({
      club_id: club.club_id,
      player_id: p.player_id,
      gamertag: p.gamertag,
      position: p.position,
      rating: Math.round((5 + rnd() * 5) * 100) / 100,
      goals: p.position === "forward" ? intBetween(0, 3) : intBetween(0, 1),
      assists: intBetween(0, 2),
      shots: intBetween(0, 6),
      passes_made: intBetween(5, 40),
      passes_attempted: intBetween(8, 48),
      tackles_made: intBetween(0, 9),
      tackles_attempted: intBetween(0, 12),
      saves: p.position === "goalkeeper" ? intBetween(0, 7) : 0,
      seconds_played: intBetween(3000, 5500),
      man_of_the_match: rnd() > 0.85,
      red_card: rnd() > 0.95,
      clean_sheet: their === 0,
    }));
    MATCHES.push({
      id: `m-${matchSeq}`,
      match_id: String(matchSeq++),
      timestamp: iso(i, intBetween(18, 22), intBetween(0, 59)),
      kind: i === 7 ? "playoff" : i === 9 ? "friendly" : "league",
      playoff_round: i === 7 ? "Quarter-final" : "",
      home_club_id: club.club_id,
      away_club_id: opponent.club_id,
      home_club_name: club.name,
      home_club_tag: club.tag,
      away_club_name: opponent.name,
      away_club_tag: opponent.tag,
      home_goals: our,
      away_goals: their,
      decided_by_forfeit: i === 8,
      home_result: result,
      our_side: "home",
      our_goal: undefined as never,
      our_result: result,
      our_goals: our,
      their_goals: their,
      opponent_id: opponent.club_id,
      opponent_name: opponent.name,
      opponent_tag: opponent.tag,
      avg_rating: Math.round((6 + rnd() * 3) * 100) / 100,
      players,
      events: null,
    } as unknown as Match);
  }
}

/** A partida vista pelo clube pedido, como o backend faz em `orient()`
 * (clubs_repository.go).
 *
 * Os MATCHES são gravados da visão do mandante. Sem reorientar, a lista de um
 * clube que foi visitante lê os gols do outro lado e o adversário errado. A
 * orientação REAL da partida (home/away, gols, resultado do mandante) fica
 * intacta — só os campos `our_*`/`opponent_*` mudam, senão a página da partida
 * mostraria o placar invertido. */
function orientFrom(m: Match, clubId: string): Match {
  if (m.home_club_id === clubId) {
    return { ...m, our_side: "home", our_result: m.home_result, our_goals: m.home_goals, their_goals: m.away_goals, opponent_id: m.away_club_id, opponent_name: m.away_club_name, opponent_tag: m.away_club_tag };
  }
  const mirror: Record<Resultado, Resultado> = { win: "loss", loss: "win", draw: "draw" };
  return {
    ...m,
    our_side: "away",
    our_result: mirror[m.home_result],
    our_goals: m.away_goals,
    their_goals: m.home_goals,
    opponent_id: m.home_club_id,
    opponent_name: m.home_club_name,
    opponent_tag: m.home_club_tag,
  };
}

export function matchesOf(clubId: string, limit = 25): Match[] {
  return MATCHES.filter((m) => m.home_club_id === clubId || m.away_club_id === clubId)
    .slice(0, limit)
    .map((m) => orientFrom(m, clubId));
}

// Os adversários de cada clube, derivados das partidas como o backend faz
// (clubshandlers.go). O H2H escolhe o rival daqui: o confronto só existe se
// os dois já se enfrentaram, então esta lista é a fonte certa.
for (const club of CLUBS) {
  const byOpponent = new Map<string, Adversario>();
  for (const m of matchesOf(club.club_id, 100)) {
    const oppId = m.home_club_id === club.club_id ? m.away_club_id : m.home_club_id;
    const opp = CLUBS.find((c) => c.club_id === oppId);
    if (!opp) continue;
    const a = byOpponent.get(oppId) ?? {
      club_id: oppId, name: opp.name, tag: opp.tag,
      played: 0, wins: 0, draws: 0, losses: 0, goals: 0, goals_against: 0,
      last_match: m.timestamp,
    };
    a.played++;
    if (m.our_result === "win") a.wins++;
    else if (m.our_result === "loss") a.losses++;
    else a.draws++;
    a.goals += m.our_goals;
    a.goals_against += m.their_goals;
    if (m.timestamp > a.last_match) a.last_match = m.timestamp;
    byOpponent.set(oppId, a);
  }
  club.adversarios = [...byOpponent.values()].sort((x, y) => (x.last_match < y.last_match ? 1 : -1));
}

// --- jogadores -------------------------------------------------------------

export const PLAYERS: PlayerProfile[] = (() => {
  const seen = new Map<string, PlayerProfile>();
  for (const club of CLUBS) {
    for (const m of squadOf(club.club_id)) {
      if (seen.has(m.gamertag)) continue;
      const clubMatches = matchesOf(club.club_id, 6);
      // A evolução por temporada (FR-013) sai das partidas, como no backend:
      // a fonte não tem temporada. Aqui o mock concentra as partidas em duas
      // temporadas para o gráfico ter mais de uma barra.
      const seasons = seasonRollup(m.goals, m.assists, m.played);
      seen.set(m.gamertag, {
        player_id: m.player_id,
        gamertag: m.gamertag,
        position: m.position,
        club_id: club.club_id,
        club_name: club.name,
        club_tag: club.tag,
        played: m.played,
        goals: m.goals,
        assists: m.assists,
        rating: m.rating,
        goals_per_game: m.goals_per_game,
        assists_per_game: m.assists_per_game,
        pass_accuracy: m.pass_accuracy,
        tackle_accuracy: m.tackle_accuracy,
        man_of_the_match: m.man_of_the_match,
        seconds_played: m.seconds_played,
        clean_sheets: m.clean_sheets,
        red_cards: m.red_cards,
        goalkeeper: m.goalkeeper,
        form: m.form,
        saves_by_type: m.saves_by_type,
        clubs: [
          {
            club_id: club.club_id,
            name: club.name,
            tag: club.tag,
            played: m.played,
            goals: m.goals,
            assists: m.assists,
            rating: m.rating,
            // Carreira: o acumulado, maior que a temporada -- é o que o perfil
            // mostra na linha "career".
            career: {
              played: m.played * 3,
              goals: m.goals * 2 + 40,
              assists: m.assists * 2 + 30,
              man_of_the_match: m.man_of_the_match * 3,
              rating: Math.round((m.rating + 0.2) * 100) / 100,
            },
          },
        ],
        verified: m.gamertag === "ItsPuIga",
        matches: clubMatches.map((mm) => ({
          match_id: mm.match_id,
          timestamp: mm.timestamp,
          kind: mm.kind,
          opponent_name: mm.opponent_name,
          resultado: mm.our_result,
          home_goals: mm.home_goals,
          away_goals: mm.away_goals,
          rating: Math.round((5 + rnd() * 5) * 100) / 100,
          goals: intBetween(0, 3),
          assists: intBetween(0, 2),
          shots: intBetween(0, 6),
          passes_made: intBetween(5, 40),
          passes_attempted: intBetween(8, 48),
          tackles_made: intBetween(0, 9),
          tackles_attempted: intBetween(0, 12),
          seconds_played: intBetween(3000, 5500),
        })),
        seasons,
      });
    }
  }
  return [...seen.values()];
})();

/** A evolução de gols por temporada (FR-013), sintetizada para o demo.
 *
 * O backend deriva a temporada da data das partidas (julho a junho), mas o
 * mock só tem dez dias de partidas — daria uma temporada só e o gráfico
 * ficaria degenerado, justo o estado que o demo precisa cobrir. Então aqui a
 * série é gerada a partir dos totais do jogador, espalhados em três
 * temporadas com a temporada atual por último. Determinístico (mesma seed,
 * mesma tela) e rotulado "AAAA/AA" como o backend. */
function seasonRollup(totalGoals: number, totalAssists: number, totalPlayed: number): PlayerSeason[] {
  const now = new Date("2026-09-22T00:00:00Z");
  const startYear = now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const splits = [0.28, 0.34, 0.38]; // fração dos totais em cada temporada
  return splits.map((frac, i) => {
    const y = startYear - (splits.length - 1 - i);
    const played = Math.max(1, Math.round(totalPlayed * frac));
    return {
      season: `${y}/${String((y + 1) % 100).padStart(2, "0")}`,
      played,
      goals: Math.round(totalGoals * frac),
      assists: Math.round(totalAssists * frac),
      rating: Math.round((6.4 + rnd() * 1.8) * 100) / 100,
    };
  });
}

export function playerById(id: string): PlayerProfile | undefined {
  return PLAYERS.find((p) => p.player_id === id);
}

// --- histórico -------------------------------------------------------------

export function evolutionOf(clubId: string): Evolution {
  const club = CLUBS.find((c) => c.club_id === clubId) ?? MY_CLUB;
  const serie = Array.from({ length: 14 }, (_, i) => ({
    read_at: iso(13 - i, 12, 0),
    skill_rating: club.skill_rating - (14 - i) * intBetween(2, 9),
    division_at_read: i < 5 ? 2 : 1,
    played: club.played - (14 - i),
    wins: Math.max(0, club.wins - Math.round((14 - i) * 0.7)),
    draws: club.draws,
    losses: Math.max(0, club.losses - Math.round((14 - i) * 0.2)),
    goals: Math.max(0, club.goals - (14 - i) * 4),
    goals_conceded: Math.max(0, club.goals_conceded - (14 - i)),
    squad_size: 16,
  }));
  return { serie, total: serie.length, current: serie[serie.length - 1], historico_curto: false };
}

export const DIVISION_CHANGES: DivisionChange[] = [
  { detected_at: iso(3, 10, 0), previous_division: 2, new_division: 1, kind: "promotion" },
  { detected_at: iso(9, 10, 0), previous_division: 3, new_division: 2, kind: "promotion" },
];

/** Os recordes do hub inteiro, derivados das partidas de todos os clubes --
 * como o backend faz. O clube "dono" de cada recorde é o lado vencedor. */
export function globalRecordsOf(): GlobalRecords {
  const ref = (c: Club | undefined): GlobalRecordClub => ({
    club_id: c?.club_id ?? "", name: c?.name ?? "", tag: c?.tag ?? "",
  });
  const clubOf = (id: string) => CLUBS.find((c) => c.club_id === id);
  const all = MATCHES;
  const byMargin = [...all].sort((a, b) => Math.abs(b.home_goals - b.away_goals) - Math.abs(a.home_goals - a.away_goals));
  const byTotal = [...all].sort((a, b) => b.home_goals + b.away_goals - (a.home_goals + a.away_goals));
  const win = byMargin.find((m) => m.home_goals !== m.away_goals);
  const top = byTotal[0];
  const winHome = (win?.home_goals ?? 0) >= (win?.away_goals ?? 0);
  const scorer = [...PLAYERS].sort((a, b) => b.goals - a.goals)[0];
  return {
    biggest_win: win ? {
      match_id: win.match_id, timestamp: win.timestamp,
      club: ref(clubOf(winHome ? win.home_club_id : win.away_club_id)),
      opponent: ref(clubOf(winHome ? win.away_club_id : win.home_club_id)),
      club_goals: winHome ? win.home_goals : win.away_goals,
      opp_goals: winHome ? win.away_goals : win.home_goals,
      total_goals: win.home_goals + win.away_goals,
    } : null,
    highest_scoring_match: top ? {
      match_id: top.match_id, timestamp: top.timestamp,
      club: ref(clubOf(top.home_club_id)), opponent: ref(clubOf(top.away_club_id)),
      club_goals: top.home_goals, opp_goals: top.away_goals,
      total_goals: top.home_goals + top.away_goals,
    } : null,
    best_rating: scorer ? {
      player_id: scorer.player_id, gamertag: scorer.gamertag,
      club: ref(clubOf(scorer.club_id)), opponent_name: "",
      match_id: top?.match_id ?? "", timestamp: top?.timestamp ?? new Date().toISOString(), rating: 9.9,
    } : null,
    top_scorer: scorer ? {
      player_id: scorer.player_id, gamertag: scorer.gamertag,
      club: ref(clubOf(scorer.club_id)), goals: scorer.goals, assists: scorer.assists, played: scorer.played,
    } : null,
    total_matches: all.length,
    total_clubs: CLUBS.filter((c) => c.tracked).length,
  };
}

export function recordsOf(clubId: string): Records {
  const club = CLUBS.find((c) => c.club_id === clubId) ?? MY_CLUB;
  const ms = matchesOf(club.club_id, 10);
  const byScore = [...ms].sort((a, b) => b.our_goals - b.their_goals - (a.our_goals - a.their_goals));
  const byLoss = [...ms].sort((a, b) => b.their_goals - b.our_goals - (a.their_goals - a.our_goals));
  const byTotal = [...ms].sort((a, b) => b.home_goals + b.away_goals - (a.home_goals + a.away_goals));
  const best = byScore[0], worst = byLoss[0], tops = byTotal[0];
  const star = squadOf(club.club_id)[0];
  const mk = (m: Match | undefined): RecordMatch | null =>
    m ? { match_id: m.match_id, timestamp: m.timestamp, opponent_name: m.opponent_name, our_goals: m.our_goals, their_goals: m.their_goals, total_goals: m.home_goals + m.away_goals } : null;
  return {
    biggest_win: mk(best),
    worst_loss: mk(worst),
    highest_scoring_match: mk(tops),
    best_rating: star && tops ? { player_id: star.player_id, gamertag: star.gamertag, match_id: tops.match_id, timestamp: tops.timestamp, opponent_name: tops.opponent_name, rating: 9.8, goals: 2 } : null,
    most_goals_in_match: star && tops ? { player_id: star.player_id, gamertag: star.gamertag, match_id: tops.match_id, timestamp: tops.timestamp, opponent_name: tops.opponent_name, rating: 8.4, goals: 5 } : null,
    longest_win_streak: 8,
    clean_sheets: club.clean_sheets,
    total_matches: club.played,
  };
}

/** A linha do tempo do clube no demo: divisões, recordes e a entrada no hub,
 * montados do mesmo dado dos recordes/snapshots -- como o backend deriva. */
export function timelineOf(clubId: string): TimelineEntry[] {
  const club = CLUBS.find((c) => c.club_id === clubId) ?? MY_CLUB;
  const rec = recordsOf(club.club_id);
  const entries: TimelineEntry[] = [
    { at: iso(20, 10, 0), kind: "seguido", title: "Clube entrou no hub", data: {} },
  ];
  for (const ch of DIVISION_CHANGES) {
    entries.push({
      at: ch.detected_at,
      kind: "divisao",
      title: ch.kind === "promotion" ? "Promovido" : "Rebaixado",
      data: { previous_division: ch.previous_division, new_division: ch.new_division, change_kind: ch.kind },
    });
  }
  if (rec.biggest_win) {
    entries.push({
      at: rec.biggest_win.timestamp, kind: "recorde", title: "Maior goleada",
      detail: rec.biggest_win.opponent_name,
      data: { record: "biggest_win", our_goals: rec.biggest_win.our_goals, their_goals: rec.biggest_win.their_goals },
    });
  }
  if (rec.highest_scoring_match) {
    entries.push({
      at: rec.highest_scoring_match.timestamp, kind: "recorde", title: "Jogo com mais gols",
      detail: rec.highest_scoring_match.opponent_name,
      data: { record: "highest_scoring", total_goals: rec.highest_scoring_match.total_goals },
    });
  }
  void club;
  return entries.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

/** A mudança desde a primeira leitura, derivada da série de snapshots. */
export function deltasOf(clubId: string): ClubDeltas {
  const ev = evolutionOf(clubId);
  const serie = ev.serie ?? [];
  if (serie.length === 0) {
    return { since: null, matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, skill_delta: 0, division_from: 0, division_to: 0 };
  }
  const first = serie[0], last = serie[serie.length - 1];
  return {
    since: first.read_at,
    matches: last.played - first.played,
    wins: last.wins - first.wins,
    draws: last.draws - first.draws,
    losses: last.losses - first.losses,
    goals: last.goals - first.goals,
    skill_delta: last.skill_rating - first.skill_rating,
    division_from: first.division_at_read,
    division_to: last.division_at_read,
  };
}

export function h2h(aId: string, bId: string): HeadToHead {
  const a = CLUBS.find((c) => c.club_id === aId) ?? MY_CLUB;
  const b = CLUBS.find((c) => c.club_id === bId) ?? CLUBS[1];
  const ref = (c: Club): ClubRef => ({
    club_id: c.club_id, name: c.name, tag: c.tag,
    crest_asset_id: c.crest_asset_id, color_1: c.color_1, color_2: c.color_2, color_3: c.color_3, color_4: c.color_4,
    division_at_read: c.division, skill_rating: c.skill_rating, points: c.points, goals: c.goals,
    goals_conceded: c.goals_conceded, clean_sheets: c.clean_sheets,
    sequencia_invicta: c.streak?.unbeaten ?? 0, tracked: c.tracked,
  });
  // Só os confrontos DIRETOS entre a e b, como o backend (filtra por
  // adversário). Sem o filtro, o seletor de rival não mudaria nada.
  const meetings = matchesOf(a.club_id, 500).filter((m) => m.opponent_id === bId).slice(0, 10);
  const form: string[] = [];
  const h: HeadToHead = {
    club_a: ref(a), club_b: ref(b), played: meetings.length,
    wins_a: 0, draws: 0, losses_a: 0, goals_a: 0, goals_b: 0, form_a: form,
    matches: meetings,
  };
  for (const m of meetings) {
    h.goals_a += m.our_goals;
    h.goals_b += m.their_goals;
    if (m.our_result === "win") {
      h.wins_a++;
      form.push("V");
    } else if (m.our_result === "loss") {
      h.losses_a++;
      form.push("D");
    } else {
      h.draws++;
      form.push("E");
    }
  }
  return h;
}

// --- anúncios e rankings ---------------------------------------------------

// Os anúncios carregam os FATOS (`data`), como o backend grava agora: quem
// desenha monta a frase no idioma escolhido. O `title` fica como fallback,
// igual às linhas antigas do banco.
const ANNOUNCE_RESULTS = ["win", "win", "draw", "win", "loss", "win", "win", "loss"] as const;
export const ANNOUNCEMENTS: Announcement[] = ANNOUNCE_RESULTS.map((result, i) => {
  const our = intBetween(1, 6);
  const their = result === "win" ? intBetween(0, our - 1) : result === "loss" ? our + intBetween(1, 3) : our;
  const ranking = i % 5 === 4;
  return {
    id: `a${i}`,
    kind: ranking ? "ranking" : "resultado",
    title: ranking ? "Ranking atualizado" : `${result === "win" ? "Vitória" : result === "loss" ? "Derrota" : "Empate"} por ${our}–${their}`,
    body: "",
    reference_id: String(matchSeq - i),
    icon: ranking ? "ranking" : "resultado",
    data: ranking ? null : { result, our_goals: our, their_goals: their, match_kind: "league" },
    generated_at: iso(0, 18 - i, intBetween(0, 59)),
  };
});

export function rankingsClubs(metric: string): ClubRef[] {
  const key = (c: Club): number =>
    metric === "points" ? c.points : metric === "goals" ? c.goals : metric === "clean_sheets" ? c.clean_sheets : c.skill_rating;
  return [...CLUBS]
    .sort((a, b) => key(b) - key(a))
    .map((c) => ({
      club_id: c.club_id, name: c.name, tag: c.tag,
      crest_asset_id: c.crest_asset_id, color_1: c.color_1, color_2: c.color_2, color_3: c.color_3, color_4: c.color_4,
      division_at_read: c.division, skill_rating: c.skill_rating, points: c.points,
      goals: c.goals, goals_conceded: c.goals_conceded, clean_sheets: c.clean_sheets,
      sequencia_invicta: c.streak?.unbeaten ?? 0, tracked: c.tracked,
    }));
}

export function rankingsPlayers(metric: string): RankPlayer[] {
  const key = (p: PlayerProfile): number =>
    metric === "goals" ? p.goals : metric === "assists" ? p.assists : metric === "goals_per_game" ? p.goals_per_game : p.rating;
  return [...PLAYERS]
    .sort((a, b) => key(b) - key(a))
    .map((p) => ({
      player_id: p.player_id, gamertag: p.gamertag, position: p.position,
      club_id: p.club_id, club_name: p.club_name, club_tag: p.club_tag,
      played: p.played, goals: p.goals, assists: p.assists, rating: p.rating,
      goals_per_game: p.goals_per_game, verified: p.verified,
    }));
}

// --- pessoais (o "usuário" do demo) ----------------------------------------

export const WATCHLIST: WatchEntry[] = CLUBS.slice(0, 6).map((c, i) => ({
  club_id: c.club_id,
  name: c.name,
  tag: c.tag,
  division_at_read: c.division,
  skill_rating: c.skill_rating,
  tracked_since: iso(20 - i, 12, 0),
  source: i === 0 ? "own" : i < 4 ? "rival" : "rival_of_rival",
}));

export const NOTIFICATION_PREFS: NotificationPrefs = {
  channel: "#vilanova-digest",
  weekly_digest: true,
  records_and_divisions: true,
  match_results: true,
};

export const SYNC_RUN: SyncRun = {
  running: false,
  skill_rating: 3,
  total: 34,
  completed: 34,
  current: "",
  new_items: [],
  started_at: iso(0, 17, 0),
  finished_at: iso(0, 17, 4),
  cooldown_segundos: 0,
};

export const ADMIN_STATUS: AdminStatus = {
  clubs_total: CLUBS.length,
  clubs_tracked: CLUBS.filter((c) => c.tracked).length,
  clubs_pending: CLUBS.filter((c) => !c.tracked).length,
  matches: MATCHES.length,
  players: PLAYERS.length,
  snapshots: 142,
  division_changes: DIVISION_CHANGES.length,
  announcements: ANNOUNCEMENTS.length,
  last_match_at: MATCHES[0]?.timestamp ?? null,
  by_division: { "1": 3, "2": 6, "3": 7 },
  top_clubs: rankingsClubs("skill_rating").slice(0, 5),
};

export const ADMIN_INGEST = {
  cycles: 128,
  clubs_ok: CLUBS.filter((c) => c.tracked).length,
  clubs_failed: 0,
  new_matches: MATCHES.length,
  snapshots: 142,
  bootstrapped: true,
  alive: true,
  last_cycle_at: iso(0, 18, 5),
  last_error: "",
  last_error_at: null,
};

// ---------------------------------------------------------------- analytics
// Derivadas do mesmo dado do demo, como o backend faz a partir do acervo.

/** Temporadas do clube: agrupa as partidas pelo rótulo "AAAA/AA" (mesma regra
 * do backend -- julho a junho). */
export function seasonsOf(clubId: string): SeasonList {
  const ms = matchesOf(clubId, 100);
  const bySeason = new Map<string, Match[]>();
  for (const m of ms) {
    const d = new Date(m.timestamp);
    const y = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
    const label = `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
    const arr = bySeason.get(label) ?? [];
    arr.push(m);
    bySeason.set(label, arr);
  }
  const labels = [...bySeason.keys()].sort();
  const squad = squadOf(clubId);
  const seasons: SeasonSummary[] = labels.map((label) => {
    const arr = bySeason.get(label) ?? [];
    let wins = 0, draws = 0, losses = 0, goals = 0, against = 0;
    for (const m of arr) {
      goals += m.our_goals;
      against += m.their_goals;
      if (m.our_result === "win") wins++;
      else if (m.our_result === "loss") losses++;
      else draws++;
    }
    // Artilheiros: os do elenco atual, rateados pela fração de jogos da temporada.
    const jogos = Math.max(1, arr.length);
    const scorers: SeasonScorer[] = squad
      .slice(0, 6)
      .map((p, i) => ({
        player_id: p.player_id,
        gamertag: p.gamertag,
        played: Math.max(1, Math.round((p.played * jogos) / 20)),
        goals: Math.max(0, Math.round((p.goals * jogos) / 20) - i),
        assists: Math.max(0, Math.round((p.assists * jogos) / 20)),
        rating: p.rating,
      }))
      .filter((s) => s.goals > 0)
      .sort((a, b) => b.goals - a.goals);
    return { season: label, played: arr.length, wins, draws, losses, goals, against, scorers };
  });
  return { seasons, current: labels[labels.length - 1] ?? "" };
}

export function positionHeatmapOf(clubId: string): PositionHeatmap {
  const squad = squadOf(clubId);
  const counts = new Map<Position, number>();
  for (const p of squad) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const ordem: Position[] = ["goalkeeper", "defender", "midfielder", "forward"];
  const buckets = ordem.filter((p) => counts.has(p)).map((p) => ({ position: p, players: counts.get(p)! }));
  return { buckets, total: squad.length };
}

export function squadComparisonOf(clubId: string): SquadComparison {
  const squad = squadOf(clubId);
  // Demo: metade "entrou", alguns "saíram" -- para a tela ter o que mostrar.
  const entraram: SquadChange[] = squad.slice(0, 3).map((p) => ({
    player_id: p.player_id, gamertag: p.gamertag, position: p.position, goals: p.goals, kind: "entrou",
  }));
  const saíram: SquadChange[] = squad.slice(3, 5).map((p) => ({
    player_id: p.player_id + "-old", gamertag: p.gamertag + " (antigo)", position: p.position, goals: Math.max(0, p.goals - 4), kind: "saiu",
  }));
  return { from: "2025/26", to: "2026/27", stayed: Math.max(0, squad.length - 5), entraram, sairam: saíram };
}

export function rollingGoalsOf(clubId: string): RollingGoals {
  const ms = matchesOf(clubId, 20).slice().reverse();
  return {
    matches: ms.map((m) => ({
      match_id: m.match_id, timestamp: m.timestamp, opponent: m.opponent_name,
      our: m.our_goals, their: m.their_goals, result: m.our_result,
    })),
  };
}

export function mainRivalOf(clubId: string): MainRival | null {
  const club = CLUBS.find((c) => c.club_id === clubId) ?? MY_CLUB;
  const advs = club.adversarios ?? [];
  if (!advs.length) return null;
  const top = [...advs].sort((a, b) => b.played - a.played)[0];
  return {
    club_id: top.club_id, name: top.name, tag: top.tag, played: top.played,
    wins: top.wins, draws: top.draws, losses: top.losses, goals: top.goals,
    goals_against: top.goals_against, last_match: top.last_match,
    matches: top.played,
  };
}

export function idleOf(clubId: string): ClubIdle {
  const ms = matchesOf(clubId, 1);
  if (!ms.length) return { last_match: null, days: 0, idle: false };
  const last = ms[0].timestamp;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  return { last_match: last, days, idle: days >= 7 };
}

export function bestByPositionOf(clubId: string): BestByPosition[] {
  const squad = squadOf(clubId);
  const best = new Map<Position, SquadMember>();
  for (const p of squad) {
    const cur = best.get(p.position);
    if (!cur || p.rating > cur.rating) best.set(p.position, p);
  }
  const ordem: Position[] = ["goalkeeper", "defender", "midfielder", "forward"];
  return ordem.filter((p) => best.has(p)).map((p) => ({ position: p, player: best.get(p)! }));
}

export const REGIONS: RegionCount[] = [
  { region_id: "5457237", clubs: 6, tracked: 4, top_name: CLUBS[0].name },
  { region_id: "1000000", clubs: 4, tracked: 2, top_name: CLUBS[2].name },
  { region_id: "2000000", clubs: 3, tracked: 1, top_name: CLUBS[4].name },
];

export const HUB_REPORT: HubReport = {
  clubs: CLUBS.length,
  tracked_clubs: CLUBS.filter((c) => c.tracked).length,
  matches: MATCHES.length,
  players: PLAYERS.length,
  snapshots: MATCHES.length,
  first_match: MATCHES.length ? MATCHES[MATCHES.length - 1].timestamp : null,
  last_match: MATCHES.length ? MATCHES[0].timestamp : null,
  coverage_days: 120,
};

export function ratingEvolutionOf(playerId: string): PlayerRatingEvolution {
  const rows: RatingPoint[] = [];
  for (const m of MATCHES) {
    const line = (m.players ?? []).find((p) => p.player_id === playerId);
    if (!line) continue;
    rows.push({
      match_id: m.match_id, timestamp: m.timestamp, opponent: m.opponent_name,
      rating: line.rating, goals: line.goals, assists: line.assists, result: m.our_result,
    });
  }
  // MATCHES vem do mais recente para o mais antigo; o gráfico e a tenure leem
  // do mais antigo para o mais novo, senão a duração sai negativa.
  rows.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  return { points: rows };
}
export function consistencyOf(playerId: string): PlayerConsistency {
  const points = ratingEvolutionOf(playerId).points ?? [];
  if (!points.length) return { played: 0, mean: 0, std_dev: 0, best: 0, worst: 0, volatility: 0 };
  const notas = points.map((p) => p.rating);
  const mean = notas.reduce((a, b) => a + b, 0) / notas.length;
  const variance = notas.reduce((a, b) => a + (b - mean) ** 2, 0) / notas.length;
  const std = Math.sqrt(variance);
  return {
    played: notas.length,
    mean: Math.round(mean * 100) / 100,
    std_dev: Math.round(std * 100) / 100,
    best: Math.max(...notas),
    worst: Math.min(...notas),
    volatility: mean > 0 ? Math.round((std / mean) * 10000) / 100 : 0,
  };
}

export function disciplineOf(playerId: string): PlayerDiscipline {
  let red = 0, matches = 0, clean = 0;
  for (const m of MATCHES) {
    const line = (m.players ?? []).find((p) => p.player_id === playerId);
    if (!line) continue;
    matches++;
    if (line.red_card) red++;
    if (line.clean_sheet) clean++;
  }
  return { red_cards: red, matches, clean_sheets: clean };
}

export function tenuresOf(playerId: string): PlayerClubTenure[] {
  const rows = ratingEvolutionOf(playerId).points ?? [];
  const club = CLUBS.find((c) => squadOf(c.club_id).some((p) => p.player_id === playerId));
  if (!club || !rows.length) return [];
  return [{
    club_id: club.club_id,
    club_name: club.name,
    first_seen: rows[0].timestamp,
    last_seen: rows[rows.length - 1].timestamp,
    matches: rows.length,
    days: Math.floor((+new Date(rows[rows.length - 1].timestamp) - +new Date(rows[0].timestamp)) / 86400000),
  }];
}

export function playerEventsOf(playerId: string): PlayerEventBreakdown {
  // Sem eventos reais no mock; devolve uma distribuição plausível.
  const rows = ratingEvolutionOf(playerId).points ?? [];
  if (!rows.length) return { player_id: playerId, events: [] };
  const goals = rows.reduce((a, r) => a + r.goals, 0);
  const assists = rows.reduce((a, r) => a + r.assists, 0);
  return {
    player_id: playerId,
    events: [
      { label: "chute", count: goals * 3 + 4 },
      { label: "chute_no_gol", count: goals + 2 },
      { label: "passe_certo", count: assists * 4 + 20 },
      { label: "desarme", count: rows.length * 2 },
    ].sort((a, b) => b.count - a.count),
  };
}
