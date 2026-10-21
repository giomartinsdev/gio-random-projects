import { driftMorale, computeAttendance, gateReceipts, prizeMoney, weeklyCommercial, weeklyCosts } from "./economy";
import { buildFixtures, computeTable, positionOf, resolveSeason } from "./league";
import { createClubs } from "./data";
import { simulateMatch } from "./match";
import { Rng } from "./rng";
import { squadRating } from "./squad";
import type {
  Career,
  Club,
  CommandResult,
  Fixture,
  FormResult,
  FreeAgent,
  MatchResult,
  Mentality,
} from "./types";

export interface CreateArgs {
  seed: number;
  /**
   * A ready-made set of clubs (a real league snapshot). When supplied, the
   * generated pyramid is skipped entirely — the world is whatever the provider
   * returned.
   */
  clubs?: Club[];
  source?: "fictional" | "licensed";
  dataProvider?: string;
  /** Which club in the starting division the player takes over. */
  clubId?: string;
  /** How many divisions exist. 1 keeps a season short for tests. */
  divisions?: number;
  tier?: number;
  mentality?: Mentality;
}

const TIER_NAMES: Record<number, string> = {
  1: "Premier League",
  2: "Championship",
  3: "League One",
  4: "League Two",
  5: "National League",
  6: "National League North",
};

export function tierName(tier: number, totalTiers: number): string {
  if (tier === totalTiers) return TIER_NAMES[6] ?? `Tier ${tier}`;
  if (tier === 1 && totalTiers === 1) return TIER_NAMES[6];
  return TIER_NAMES[tier] ?? `Tier ${tier}`;
}

/**
 * Creates a career.
 *
 * The starting tier is the *bottom* of the pyramid by default, because that is
 * the premise: a club nobody has heard of, thirty seasons from the Premier
 * League. Everything the career needs is materialised here, so a save file is
 * self-contained and loadable without re-running generation.
 */
export function createCareer({
  seed,
  clubId,
  divisions = 5,
  tier,
  mentality = "balanced",
  clubs: supplied,
  source = "fictional",
  dataProvider,
}: CreateArgs): Career {
  const totalTiers = Math.max(1, divisions);
  const startingTier = tier ?? totalTiers;
  const rng = new Rng(seed);

  const clubs = supplied && supplied.length >= 2 ? evenSquadOf(supplied) : createClubs(rng, startingTier, totalTiers);
  const playerClub = clubId
    ? (clubs.find((club) => club.id === clubId) ?? clubs[0])
    : clubs[0];

  const clubMap: Record<string, Club> = {};
  for (const club of clubs) clubMap[club.id] = club;

  const fixtures = buildFixtures(clubs.map((club) => club.id));
  const totalWeeks = fixtures.reduce((max, f) => Math.max(max, f.week), 0);

  return {
    version: 1,
    seed,
    source,
    dataProvider,
    rngCursor: 0,
    week: 0,
    season: 2026,
    totalTiers,
    playerClubId: playerClub.id,
    mentality,
    clubs: clubMap,
    fixtures,
    results: [],
    clubPosition: 10,
    form: [],
    seasonComplete: false,
    dismissed: false,
    trophies: [],
    history: [],
    totalWeeks,
  };
}

export interface AdvanceOptions {
  /**
   * Mentality per club, supplied by the friend league. A club not listed here
   * plays balanced — the same arm's-length model the rest of the division gets.
   */
  mentalities?: Record<string, Mentality>;
}

/**
 * Advances the career by one week: plays every fixture scheduled for that week,
 * then settles finances for the player's club only (the rest of the division is
 * simulated at arm's length — a prototype does not need 19 balance sheets).
 */
export function advanceWeek(
  career: Career,
  { mentalities = {} }: AdvanceOptions = {},
): Career {
  if (career.seasonComplete) return career;

  const week = career.week + 1;
  const fixtures = career.fixtures.map((fixture) => {
    if (fixture.week !== week || fixture.played) return fixture;

    const home = career.clubs[fixture.homeId];
    const away = career.clubs[fixture.awayId];
    if (!home || !away) return fixture;

    // The pick belongs to the club, not to the home slot: your mentality has to
    // survive an away trip, or the tactic is only half a tactic.
    const mentalityOf = (clubId: string): Mentality =>
      mentalities[clubId] ??
      (clubId === career.playerClubId ? career.mentality : "balanced");

    const result = simulateMatch({
      home,
      away,
      seed: career.seed,
      mentality: mentalityOf(fixture.homeId),
      awayMentality: mentalityOf(fixture.awayId),
      fixtureId: fixture.id,
    });

    return { ...fixture, played: true, result };
  });

  const playedThisWeek = fixtures.filter(
    (f) => f.week === week && f.played && f.result,
  );
  const newResults = playedThisWeek.map((f) => f.result as MatchResult);

  const clubs = { ...career.clubs };
  let playerResult: MatchResult | undefined;

  for (const fixture of playedThisWeek) {
    const result = fixture.result as MatchResult;
    const home = clubs[fixture.homeId];
    const away = clubs[fixture.awayId];

    if (home) {
      const delta = result.homeGoals > result.awayGoals ? 3 : result.homeGoals === result.awayGoals ? 0 : -3;
      clubs[home.id] = driftMorale(home, delta);
    }
    if (away) {
      const delta = result.awayGoals > result.homeGoals ? 3 : result.homeGoals === result.awayGoals ? 0 : -3;
      clubs[away.id] = driftMorale(away, delta);
    }

    if (fixture.homeId === career.playerClubId || fixture.awayId === career.playerClubId) {
      playerResult = result;
    }
  }

  const table = computeTable(Object.values(clubs), fixtures);
  const position = positionOf(table, career.playerClubId);

  // Gate receipts only land on home weeks; costs are every week.
  const playerClub = clubs[career.playerClubId];
  if (playerClub) {
    const isHome = playerResult?.homeId === career.playerClubId;
    const attendance = isHome
      ? computeAttendance(playerClub, position, table.length)
      : 0;

    const income = isHome
      ? gateReceipts(attendance, playerClub.ticketPrice)
      : 0;

    clubs[career.playerClubId] = {
      ...playerClub,
      balance:
        playerClub.balance +
        income +
        weeklyCommercial(playerClub) -
        weeklyCosts(playerClub),
      lastAttendance: attendance,
    };
  }

  const form: FormResult[] = playerResult
    ? [...career.form, formOf(playerResult, career.playerClubId)].slice(-15)
    : career.form;

  const lastWeek = fixtures.reduce((max, f) => Math.max(max, f.week), 0);
  const seasonComplete = lastWeek <= week && fixtures.every((f) => f.played);

  return {
    ...career,
    week,
    fixtures,
    results: [...career.results, ...newResults],
    clubs,
    clubPosition: position,
    form,
    seasonComplete,
    rngCursor: career.rngCursor + 1,
  };
}

export interface SignResult {
  ok: boolean;
  career: Career;
  reason?: string;
}

/** Signs a free agent or a paid target. Free agents are always affordable. */
export function signPlayer(career: Career, target: FreeAgent): SignResult {
  const club = career.clubs[career.playerClubId];
  if (!club) return { ok: false, career, reason: "No club to sign for" };

  if (target.fee > 0 && club.balance < target.fee) {
    return {
      ok: false,
      career,
      reason: `The club cannot afford the £${target.fee.toLocaleString("en-GB")} fee on a balance of £${club.balance.toLocaleString("en-GB")}.`,
    };
  }

  const player = {
    id: target.id,
    name: target.name,
    position: target.position,
    age: target.age,
    ability: target.ability,
    wage: target.wage,
    value: target.value,
    morale: 70,
  };

  return {
    ok: true,
    career: {
      ...career,
      clubs: {
        ...career.clubs,
        [club.id]: {
          ...club,
          balance: club.balance - target.fee,
          players: [...club.players, player],
        },
      },
    },
  };
}

export const STADIUM_UPGRADE_COST = 75_000;

/** Each upgrade adds ~1,200 seats. Cost is flat, which keeps the choice legible. */
export function upgradeStadium(career: Career): SignResult {
  const club = career.clubs[career.playerClubId];
  if (!club) return { ok: false, career, reason: "No club to upgrade" };

  if (club.balance < STADIUM_UPGRADE_COST) {
    return {
      ok: false,
      career,
      reason: `A stand costs £${STADIUM_UPGRADE_COST.toLocaleString("en-GB")}; the club has £${club.balance.toLocaleString("en-GB")}.`,
    };
  }

  return {
    ok: true,
    career: {
      ...career,
      clubs: {
        ...career.clubs,
        [club.id]: {
          ...club,
          balance: club.balance - STADIUM_UPGRADE_COST,
          capacity: club.capacity + 1_200,
          fanMood: Math.min(100, club.fanMood + 4),
        },
      },
    },
  };
}

/** Called at season end: promotion, relegation, and the next season's fixture list. */
export function finishSeason(career: Career): Career {
  const clubs = Object.values(career.clubs);
  const table = computeTable(clubs, career.fixtures);
  const playerPosition = positionOf(table, career.playerClubId);

  const outcome = resolveSeason({
    tier: clubs[0]?.tier ?? career.totalTiers,
    totalTiers: career.totalTiers,
    table,
    // Prototype: the highest-placed play-off side wins it. A real game would
    // simulate the two semis and the final.
    playoffWinnerId: table[2]?.clubId,
    expectedClubs: table.length,
  });

  const movedUp = outcome.promoted.includes(career.playerClubId);
  const movedDown = outcome.relegated.includes(career.playerClubId);
  const currentClubBefore = career.clubs[career.playerClubId];
  const pointsRow = table.find((row) => row.clubId === career.playerClubId);
  const prize = prizeMoney(
    pointsRow?.points ?? 0,
    currentClubBefore?.tier ?? career.totalTiers,
  );
  const nextTier = movedUp
    ? Math.max(1, (clubs[0]?.tier ?? career.totalTiers) - 1)
    : movedDown
      ? Math.min(career.totalTiers, (clubs[0]?.tier ?? career.totalTiers) + 1)
      : (clubs[0]?.tier ?? career.totalTiers);

  const historyEntry = {
    season: career.season,
    tier: clubs[0]?.tier ?? career.totalTiers,
    position: playerPosition,
    outcome: movedUp ? ("promoted" as const) : movedDown ? ("relegated" as const) : ("stayed" as const),
  };

  const rng = new Rng(career.seed, career.rngCursor + 1);
  // A licensed world keeps its clubs. Regenerating them would replace a real
  // division with invented names the moment a season ends, which is the one
  // thing a dataset-backed save must never do.
  const nextClubs =
    career.source === "licensed"
      ? Object.values(career.clubs)
      : createClubs(rng, nextTier, career.totalTiers);

  // Keep the player's own club identity (name, colours, ground) across seasons.
  const currentClub = career.clubs[career.playerClubId];
  const nextClubMap: Record<string, Club> = {};
  for (const club of nextClubs) nextClubMap[club.id] = club;

  const nextPlayerClub: Club = {
    ...(nextClubs[0] ?? currentClub),
    name: currentClub.name,
    short: currentClub.short,
    colors: currentClub.colors,
    capacity: currentClub.capacity,
    balance: currentClub.balance + prize,
    ticketPrice: currentClub.ticketPrice,
    players: currentClub.players,
    fanMood: currentClub.fanMood,
    tier: nextTier,
    crestUrl: currentClub.crestUrl,
    venue: currentClub.venue,
  };
  nextClubMap[nextPlayerClub.id] = nextPlayerClub;

  const fixtures = buildFixtures(Object.keys(nextClubMap));

  return {
    ...career,
    season: career.season + 1,
    week: 0,
    totalTiers: career.totalTiers,
    clubs: nextClubMap,
    fixtures,
    results: [],
    form: [],
    clubPosition: 10,
    seasonComplete: false,
    playerClubId: nextPlayerClub.id,
    history: [...career.history, historyEntry],
    trophies: movedUp
      ? [...career.trophies, { season: career.season, tier: historyEntry.tier, position: playerPosition }]
      : career.trophies,
    rngCursor: career.rngCursor + 1,
  };
}

export function saveCareer(career: Career): string {
  return JSON.stringify(career);
}
/** Maps a fixture result onto W/D/L for one club. */
export function formOf(result: MatchResult, clubId: string): FormResult {
  const isHome = result.homeId === clubId;
  const mine = isHome ? result.homeGoals : result.awayGoals;
  const theirs = isHome ? result.awayGoals : result.homeGoals;
  return mine > theirs ? "W" : mine < theirs ? "L" : "D";
}

export function loadCareer(json: string): Career {
  const parsed = JSON.parse(json) as Career;
  if (parsed.version !== 1) throw new Error("Unsupported save version");
  return parsed;
}

export function squadSummary(career: Career) {
  const club = career.clubs[career.playerClubId];
  return {
    rating: squadRating(club),
    size: club.players.length,
    wageBill: club.players.reduce((sum, p) => sum + p.wage, 0),
  };
}

export function currentOpponent(career: Career): { fixture: Fixture; club: Club } | null {
  const next = career.fixtures.find((f) => !f.played && f.week === career.week + 1);
  if (!next) return null;
  const opponentId = next.homeId === career.playerClubId ? next.awayId : next.homeId;
  const club = career.clubs[opponentId];
  return club ? { fixture: next, club } : null;
}

/**
 * A division must have an even number of clubs — the fixture generator pairs
 * them, and an odd count leaves one club idle every week. A provider can return
 * 23 clubs for a league that should have 24, so the last one is dropped rather
 * than throwing in the player's face at startup.
 */
function evenSquadOf(clubs: Club[]): Club[] {
  return clubs.length % 2 === 0 ? clubs : clubs.slice(0, -1);
}

export type { CommandResult };
