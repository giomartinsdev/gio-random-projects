import type { Mentality, TableRow } from "./types";

/**
 * The friend league: the social layer that turns a single career into a shared
 * season.
 *
 * Design rules this file encodes, because they are the whole product:
 *
 * 1. A league is people, not a division. Friends can be split by promotion and
 *    relegation and the league survives; the season is won by whoever finishes
 *    highest up the pyramid, not by whoever happens to share a division.
 * 2. A matchday resolves once, for everyone. Nobody sees a rival's result and
 *    then picks a more attacking shape. Readiness *is* the tactical submission.
 * 3. Missing a deadline never holds the league hostage: the club is simulated,
 *    and after three misses it goes to a caretaker until someone takes it on.
 */

export type ManagerStatus = "active" | "idle";

export interface Manager {
  id: string;
  name: string;
  clubId: string;
  status: ManagerStatus;
  /** Consecutive missed deadlines. Reset by submitting or by a takeover. */
  misses: number;
}

export interface Honour {
  season: number;
  managerId: string;
  managerName: string;
  clubId: string;
  tier: number;
  position: number;
  points: number;
}

export interface ResultRecord {
  season: number;
  week: number;
  homeClubId: string;
  awayClubId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface FriendLeague {
  version: 1;
  id: string;
  name: string;
  /** Invite code, e.g. PYR-4K2M. Deterministic from the league name. */
  code: string;
  commissionerId: string;
  season: number;
  /** The matchday currently being collected. 1-based. */
  matchday: number;
  /** How long a matchday stays open before the deadline resolves it. */
  windowHours: number;
  members: Manager[];
  /** managerId -> mentality. A pick is also a readiness signal. */
  picks: Record<string, Mentality>;
  /**
   * Every matchweek already played, kept so head-to-head and honours survive
   * the fixture list being rebuilt each season.
   */
  results: ResultRecord[];
  honours: Honour[];
}

export const MISS_LIMIT = 3;

export interface CreateLeagueArgs {
  name: string;
  commissioner: { id: string; name: string; clubId: string };
  rivals?: { id: string; name: string; clubId: string }[];
  season?: number;
  windowHours?: number;
}

export function createFriendLeague({
  name,
  commissioner,
  rivals = [],
  season = 2026,
  windowHours = 24,
}: CreateLeagueArgs): FriendLeague {
  const trimmed = name.trim();
  if (trimmed.length < 3) throw new Error("A league needs a name");
  if (windowHours < 1) throw new Error("A window needs at least an hour");

  const members: Manager[] = [commissioner, ...rivals].map((member) => ({
    ...member,
    status: "active",
    misses: 0,
  }));

  if (members.length < 2) {
    throw new Error("A league needs at least two managers — otherwise it is a career");
  }

  const names = new Set(members.map((m) => m.name.toLowerCase()));
  if (names.size !== members.length) throw new Error("Manager names must be unique");

  const clubs = new Set(members.map((m) => m.clubId));
  if (clubs.size !== members.length) {
    throw new Error("Two managers cannot take the same club");
  }

  return {
    version: 1,
    id: `league-${slug(trimmed)}`,
    name: trimmed,
    code: leagueCode(trimmed),
    commissionerId: commissioner.id,
    season,
    matchday: 1,
    windowHours,
    members,
    picks: {},
    results: [],
    honours: [],
  };
}

/**
 * Invite codes are derived from the league name so they are stable, readable and
 * testable — no RNG, no collisions with a database sequence.
 */
export function leagueCode(name: string): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.abs(h) % alphabet.length];
    h = Math.imul(h ^ (h >>> 13), 2654435761);
  }
  return `PYR-${code}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function activeMembers(league: FriendLeague): Manager[] {
  return league.members.filter((m) => m.status === "active");
}

export function managerOfClub(
  league: FriendLeague,
  clubId: string,
): Manager | undefined {
  return league.members.find((m) => m.clubId === clubId);
}

export function managerById(
  league: FriendLeague,
  managerId: string,
): Manager | undefined {
  return league.members.find((m) => m.id === managerId);
}

/** A matchday is locked the moment every active manager has submitted. */
export function windowState(league: FriendLeague): "collecting" | "locked" {
  const waiting = activeMembers(league).filter((m) => !league.picks[m.id]);
  return waiting.length === 0 ? "locked" : "collecting";
}

export function waitingOn(league: FriendLeague): Manager[] {
  return activeMembers(league).filter((m) => !league.picks[m.id]);
}

/**
 * Submitting a mentality is the same act as saying "I'm ready". That is
 * deliberate: it removes the classic async-league cheat of watching the results
 * land and then changing your approach.
 */
export function submit(
  league: FriendLeague,
  managerId: string,
  mentality: Mentality,
): FriendLeague {
  const manager = managerById(league, managerId);
  if (!manager) throw new Error("Not a member of this league");
  if (manager.status !== "active") {
    throw new Error("This club is under a caretaker — take it over first");
  }
  return { ...league, picks: { ...league.picks, [managerId]: mentality } };
}

/** The mentality a submitted manager plays with; AI clubs stay balanced. */
export function mentalityFor(
  league: FriendLeague,
  clubId: string,
  fallback: Mentality = "balanced",
): Mentality {
  const manager = managerOfClub(league, clubId);
  if (!manager) return fallback;
  return league.picks[manager.id] ?? fallback;
}

export interface ResolveArgs {
  /**
   * True when the deadline has passed: managers who never submitted are
   * auto-simulated instead of blocking the league.
   */
  force?: boolean;
}

export interface ResolveOutcome {
  league: FriendLeague;
  autoSimmed: Manager[];
}

export function resolveMatchday(
  league: FriendLeague,
  { force = false }: ResolveArgs = {},
): ResolveOutcome {
  const waiting = waitingOn(league);

  if (waiting.length > 0 && !force) {
    throw new Error(
      `Waiting on ${waiting.length} manager${waiting.length === 1 ? "" : "s"}: ${waiting
        .map((m) => m.name)
        .join(", ")}`,
    );
  }

  const autoSimmed = force ? waiting : [];

  const members = league.members.map((member) => {
    if (!autoSimmed.some((m) => m.id === member.id)) return member;
    const misses = member.misses + 1;
    return {
      ...member,
      misses,
      status: misses >= MISS_LIMIT ? ("idle" as const) : member.status,
    };
  });

  return {
    league: {
      ...league,
      members,
      matchday: league.matchday + 1,
      // A clean slate is what stops yesterday's pick leaking into tomorrow.
      picks: {},
    },
    autoSimmed,
  };
}

/**
 * Records a played matchweek. Only matches where both clubs belong to managers
 * are stored: the friend head-to-head is a private competition, not a copy of
 * the division.
 *
 * Recording is idempotent for a given season and week, so a double-clicked
 * "play matchday" cannot count the same derby twice. Rows carrying a different
 * season or week are ignored rather than archived under the wrong date.
 */
export function recordMatchday(
  league: FriendLeague,
  season: number,
  week: number,
  results: ResultRecord[],
): FriendLeague {
  const managed = new Set(league.members.map((m) => m.clubId));
  const already = new Set(
    league.results
      .filter((r) => r.season === season && r.week === week)
      .map((r) => `${r.homeClubId}-${r.awayClubId}`),
  );
  const relevant = results.filter(
    (r) =>
      r.season === season &&
      r.week === week &&
      managed.has(r.homeClubId) &&
      managed.has(r.awayClubId) &&
      !already.has(`${r.homeClubId}-${r.awayClubId}`),
  );
  return { ...league, results: [...league.results, ...relevant] };
}

export interface StandingEntry {
  managerId: string;
  managerName: string;
  clubId: string;
  tier: number;
  position: number;
  points: number;
  played: number;
  status: ManagerStatus;
}

/**
 * The friend table: who is highest up the pyramid.
 *
 * Tier first, position second. A friend promoted to the division above beats a
 * friend who won a lower division — climbing is the game, so it is the tie-break
 * that matters most.
 */
export function friendStandings(
  league: FriendLeague,
  rows: TableRow[],
  tier: number,
): StandingEntry[] {
  const byClub = new Map(rows.map((row) => [row.clubId, row]));

  return league.members
    .map((member) => {
      const row = byClub.get(member.clubId);
      const position = row ? rows.indexOf(row) + 1 : rows.length + 1;
      return {
        managerId: member.id,
        managerName: member.name,
        clubId: member.clubId,
        tier,
        position,
        points: row?.points ?? 0,
        played: row?.played ?? 0,
        status: member.status,
      };
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.position - b.position ||
        b.points - a.points ||
        a.managerName.localeCompare(b.managerName),
    );
}

export interface HeadToHead {
  opponentId: string;
  opponentName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  last?: { season: number; week: number; score: string };
}

/** Head-to-head against every other manager, across every archived season. */
export function headToHead(
  league: FriendLeague,
  managerId: string,
): HeadToHead[] {
  const me = managerById(league, managerId);
  if (!me) throw new Error("Not a member of this league");

  return league.members
    .filter((other) => other.id !== managerId)
    .map((other) => {
      const record: HeadToHead = {
        opponentId: other.id,
        opponentName: other.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      };

      const meetings = league.results
        .filter(
          (r) =>
            (r.homeClubId === me.clubId && r.awayClubId === other.clubId) ||
            (r.awayClubId === me.clubId && r.homeClubId === other.clubId),
        )
        .sort((a, b) => a.season - b.season || a.week - b.week);

      for (const meeting of meetings) {
        const home = meeting.homeClubId === me.clubId;
        const mine = home ? meeting.homeGoals : meeting.awayGoals;
        const theirs = home ? meeting.awayGoals : meeting.homeGoals;
        record.played++;
        record.goalsFor += mine;
        record.goalsAgainst += theirs;
        if (mine > theirs) {
          record.won++;
          record.points += 3;
        } else if (mine < theirs) {
          record.lost++;
        } else {
          record.drawn++;
          record.points++;
        }
      }

      const last = meetings[meetings.length - 1];
      if (last) {
        record.last = {
          season: last.season,
          week: last.week,
          score: `${last.homeGoals}–${last.awayGoals}`,
        };
      }

      return record;
    })
    // Rivals you have actually met come first, ranked by points won; pairings
    // with no meetings sit at the bottom rather than posing as a 0–0 record.
    .sort((a, b) => {
      if (a.played === 0 && b.played > 0) return 1;
      if (b.played === 0 && a.played > 0) return -1;
      return b.points - a.points || a.opponentName.localeCompare(b.opponentName);
    });
}

export interface SeasonRow {
  managerId: string;
  tier: number;
  position: number;
  points: number;
}

/**
 * Closes a season and crowns the friend champion: highest tier, then highest
 * finish. Stored forever — the honours board is the reason to come back in
 * season four when your club is mid-table.
 */
export function recordSeason(
  league: FriendLeague,
  season: number,
  rows: SeasonRow[],
): FriendLeague {
  if (rows.length === 0) throw new Error("A season needs at least one manager");

  const winner = [...rows].sort(
    (a, b) =>
      a.tier - b.tier ||
      a.position - b.position ||
      b.points - a.points ||
      a.managerId.localeCompare(b.managerId),
  )[0];

  const manager = managerById(league, winner.managerId);
  if (!manager) throw new Error("The champion must be a member");

  if (league.honours.some((h) => h.season === season)) {
    throw new Error(`Season ${season} has already been recorded`);
  }

  return {
    ...league,
    honours: [
      ...league.honours,
      {
        season,
        managerId: manager.id,
        managerName: manager.name,
        clubId: manager.clubId,
        tier: winner.tier,
        position: winner.position,
        points: winner.points,
      },
    ],
  };
}

/**
 * A club whose manager has gone quiet. The commissioner can hand it to someone
 * new without losing the club's history, which is the whole point of a
 * persistent league.
 */
export function takeover(
  league: FriendLeague,
  managerId: string,
  newName: string,
): FriendLeague {
  const manager = managerById(league, managerId);
  if (!manager) throw new Error("Not a member of this league");

  return {
    ...league,
    members: league.members.map((member) =>
      member.id === managerId
        ? { ...member, name: newName, misses: 0, status: "active" }
        : member,
    ),
  };
}

/** A club can be swapped before a season starts, never mid-season. */
export function claimClub(
  league: FriendLeague,
  managerId: string,
  clubId: string,
): FriendLeague {
  const manager = managerById(league, managerId);
  if (!manager) throw new Error("Not a member of this league");
  if (league.results.length > 0) {
    throw new Error("Clubs are locked once the season has kicked off");
  }
  if (league.members.some((m) => m.clubId === clubId && m.id !== managerId)) {
    throw new Error("That club is already taken");
  }
  return {
    ...league,
    members: league.members.map((m) =>
      m.id === managerId ? { ...m, clubId } : m,
    ),
  };
}

export function saveLeague(league: FriendLeague): string {
  return JSON.stringify(league);
}

export function loadLeague(json: string): FriendLeague {
  const parsed = JSON.parse(json) as FriendLeague;
  if (parsed.version !== 1) throw new Error("Unsupported league save version");
  if (!Array.isArray(parsed.members) || parsed.members.length < 2) {
    throw new Error("A league save needs at least two managers");
  }
  return parsed;
}

