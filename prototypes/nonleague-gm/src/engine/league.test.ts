import { describe, expect, it } from "vitest";

import { buildFixtures, computeTable, resolveSeason } from "./league";
import type { Club, Fixture } from "./types";

function clubIds(count: number, tier = 5): string[] {
  return Array.from({ length: count }, (_, i) => `club-${tier}-${i + 1}`);
}

function asClubs(ids: string[], tier: number): Club[] {
  return ids.map((id) => ({
    id,
    name: id,
    short: id.toUpperCase().slice(0, 3),
    tier,
    colors: { primary: "#000", secondary: "#fff" },
    capacity: 4_000,
    balance: 50_000,
    ticketPrice: 10,
    fanMood: 55,
    players: [],
  }));
}

/** A fixture with a result applied, so the table has something to read. */
function played(
  id: string,
  homeId: string,
  awayId: string,
  week: number,
  homeGoals: number,
  awayGoals: number,
): Fixture {
  return {
    id,
    homeId,
    awayId,
    week,
    played: true,
    result: {
      homeId,
      awayId,
      homeGoals,
      awayGoals,
      result:
        homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw",
      scorers: { home: [], away: [] },
      events: [],
      homeStrength: { attack: 60, defence: 60 },
      awayStrength: { attack: 60, defence: 60 },
    },
  };
}

describe("league season", () => {
  it("builds a 380-fixture double round-robin for 20 clubs", () => {
    const fixtures = buildFixtures(clubIds(20));

    expect(fixtures).toHaveLength(380);

    const perClub = new Map<string, number>();
    for (const fixture of fixtures) {
      perClub.set(fixture.homeId, (perClub.get(fixture.homeId) ?? 0) + 1);
      perClub.set(fixture.awayId, (perClub.get(fixture.awayId) ?? 0) + 1);
    }
    expect([...perClub.values()]).toHaveLength(20);
    for (const played of perClub.values()) expect(played).toBe(38);
  });

  it("plays every pair home and away exactly once", () => {
    const fixtures = buildFixtures(clubIds(20));
    const pairs = new Map<string, number>();

    for (const fixture of fixtures) {
      const key = `${fixture.homeId}->${fixture.awayId}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }

    for (const key of pairs.keys()) expect(pairs.get(key)).toBe(1);
    expect(pairs.size).toBe(380);
  });

  it("orders the table by points, then goal difference, then goals scored", () => {
    const ids = ["a", "b", "c", "d"];
    const clubs = asClubs(ids, 3);
    const fixtures = [
      played("f1", "a", "b", 1, 3, 0),
      played("f2", "c", "d", 1, 1, 0),
      played("f3", "a", "c", 2, 0, 1),
      played("f4", "b", "d", 2, 2, 2),
    ];

    const table = computeTable(clubs, fixtures);

    // c: 2 wins, 6 pts. a: 3 pts, GD +2. d: 1 pt, GD -1. b: 1 pt, GD -3.
    expect(table.map((row) => row.clubId)).toEqual(["c", "a", "d", "b"]);
    expect(table[0].points).toBe(6);
    expect(table[1].goalDifference).toBe(2);
  });

  it("relegates the bottom three and promotes the top two", () => {
    const clubs = asClubs(clubIds(20), 3);
    const table = clubs.map((club, index) => ({
      clubId: club.id,
      played: 38,
      won: index === 0 ? 30 : 0,
      drawn: 0,
      lost: index === 0 ? 8 : 38,
      goalsFor: index === 0 ? 90 : 10,
      goalsAgainst: index === 0 ? 20 : 90,
      goalDifference: index === 0 ? 70 : -80,
      points: index === 0 ? 90 : 0,
    }));

    const outcome = resolveSeason({
      tier: 3,
      totalTiers: 5,
      table,
      playoffWinnerId: clubs[4].id,
    });

    expect(outcome.promoted).toHaveLength(3);
    expect(outcome.promoted).toContain(clubs[0].id);
    expect(outcome.promoted).toContain(clubs[1].id);
    expect(outcome.promoted).toContain(clubs[4].id);
    expect(outcome.relegated).toEqual([
      clubs[17].id,
      clubs[18].id,
      clubs[19].id,
    ]);
  });

  it("promotes exactly one club through the play-offs", () => {
    const clubs = asClubs(clubIds(20), 3);
    const table = clubs.map((club) => ({
      clubId: club.id,
      played: 38,
      won: 0,
      drawn: 0,
      lost: 38,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }));

    const outcome = resolveSeason({
      tier: 3,
      totalTiers: 5,
      table,
      playoffWinnerId: clubs[5].id,
    });

    expect(outcome.playoffPlaces).toEqual([
      clubs[2].id,
      clubs[3].id,
      clubs[4].id,
      clubs[5].id,
    ]);
    expect(outcome.promoted.filter((id) => id === clubs[5].id)).toHaveLength(1);
  });

  it("never promotes out of the top tier", () => {
    const clubs = asClubs(clubIds(20), 1);
    const table = clubs.map((club) => ({
      clubId: club.id,
      played: 38,
      won: 20,
      drawn: 10,
      lost: 8,
      goalsFor: 60,
      goalsAgainst: 30,
      goalDifference: 30,
      points: 70,
    }));

    const outcome = resolveSeason({ tier: 1, totalTiers: 5, table });

    expect(outcome.promoted).toEqual([]);
    expect(outcome.relegated).toHaveLength(3);
  });

  it("never relegates out of the bottom tier", () => {
    const clubs = asClubs(clubIds(20), 5);
    const table = clubs.map((club) => ({
      clubId: club.id,
      played: 38,
      won: 1,
      drawn: 1,
      lost: 36,
      goalsFor: 20,
      goalsAgainst: 90,
      goalDifference: -70,
      points: 4,
    }));

    const outcome = resolveSeason({ tier: 5, totalTiers: 5, table });

    expect(outcome.relegated).toEqual([]);
    expect(outcome.promoted).toHaveLength(2);
  });

  it("rejects a table that does not cover every club", () => {
    const clubs = asClubs(clubIds(20), 3);
    const table = clubs.slice(0, 18).map((club) => ({
      clubId: club.id,
      played: 38,
      won: 0,
      drawn: 0,
      lost: 38,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }));

    expect(() =>
      resolveSeason({ tier: 3, totalTiers: 5, table, expectedClubs: 20 }),
    ).toThrow(/every club/i);
  });
});
