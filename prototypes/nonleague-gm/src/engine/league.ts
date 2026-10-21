import type { Club, Fixture, SeasonOutcome, TableRow } from "./types";

/**
 * Builds a double round-robin.
 *
 * Uses the circle method: fix club 0, rotate the rest. That guarantees each pair
 * meets once at home and once away and that every club plays exactly once per
 * week — a random pairing would produce both duplicates and idle weeks.
 */
export function buildFixtures(clubIds: string[], startWeek = 1): Fixture[] {
  if (clubIds.length % 2 !== 0) {
    throw new Error("A league needs an even number of clubs");
  }

  const n = clubIds.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotation = [...clubIds];
  const fixtures: Fixture[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const a = rotation[i];
      const b = rotation[n - 1 - i];
      // Alternate home/away each round so the second leg mirrors the first.
      const homeFirst = round % 2 === 0;
      fixtures.push({
        id: `w${startWeek + round}-${a}-${b}`,
        homeId: homeFirst ? a : b,
        awayId: homeFirst ? b : a,
        week: startWeek + round,
        played: false,
      });
    }
    // Rotate everything except the fixed first element.
    rotation.splice(1, 0, rotation.pop() as string);
  }

  // Second leg: reverse every fixture and shift the week by the first leg.
  const secondLeg = fixtures.map((fixture) => ({
    id: `w${fixture.week + rounds}-${fixture.awayId}-${fixture.homeId}`,
    homeId: fixture.awayId,
    awayId: fixture.homeId,
    week: fixture.week + rounds,
    played: false,
  }));

  return [...fixtures, ...secondLeg].sort((a, b) => a.week - b.week);
}

/** League table: points, then goal difference, then goals scored. */
export function computeTable(clubs: Club[], fixtures: Fixture[]): TableRow[] {
  const rows = new Map<string, TableRow>();

  for (const club of clubs) {
    rows.set(club.id, {
      clubId: club.id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  for (const fixture of fixtures) {
    if (!fixture.played || !fixture.result) continue;
    const { homeId, awayId, homeGoals, awayGoals } = fixture.result;

    const home = rows.get(homeId);
    const away = rows.get(awayId);
    // A fixture can reference a club that has since been promoted out of the
    // division; skip rather than create a ghost row.
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (homeGoals < awayGoals) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  for (const row of rows.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.clubId.localeCompare(b.clubId),
  );
}

export interface ResolveArgs {
  tier: number;
  totalTiers: number;
  table: TableRow[];
  /** Winner of the 3rd-to-6th play-off, if one was played. */
  playoffWinnerId?: string;
  /** When set, the table must cover this many clubs or the call throws. */
  expectedClubs?: number;
}

/**
 * Turns a final table into movement between divisions.
 *
 * Two up, one more through the play-offs, three down. Top tier promotes nobody;
 * bottom tier relegates nobody. That asymmetry is the whole point of a pyramid —
 * and it is exactly where naive implementations crash.
 */
export function resolveSeason({
  tier,
  totalTiers,
  table,
  playoffWinnerId,
  expectedClubs,
}: ResolveArgs): SeasonOutcome {
  if (table.length === 0) throw new Error("The table is empty");
  if (expectedClubs !== undefined && table.length !== expectedClubs) {
    throw new Error(
      `The table must cover every club: expected ${expectedClubs}, got ${table.length}`,
    );
  }

  const relegated = tier < totalTiers ? table.slice(-3).map((r) => r.clubId) : [];

  const promoted: string[] = [];
  let playoffPlaces: string[] = [];

  if (tier > 1) {
    promoted.push(table[0].clubId, table[1].clubId);
    playoffPlaces = table.slice(2, 6).map((r) => r.clubId);

    if (playoffWinnerId) {
      if (!playoffPlaces.includes(playoffWinnerId)) {
        throw new Error("The play-off winner must finish between 3rd and 6th");
      }
      promoted.push(playoffWinnerId);
    }
  }

  return {
    promoted,
    relegated,
    playoffPlaces,
    championId: table[0]?.clubId,
  };
}

/** Position of one club in a table, 1-based. */
export function positionOf(table: TableRow[], clubId: string): number {
  const index = table.findIndex((row) => row.clubId === clubId);
  return index === -1 ? table.length : index + 1;
}
