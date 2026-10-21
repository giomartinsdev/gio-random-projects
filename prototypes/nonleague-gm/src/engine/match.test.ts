import { describe, expect, it } from "vitest";

import { computeStrength } from "./squad";
import { simulateMatch } from "./match";
import type { Club, Mentality } from "./types";

/** A minimal club whose strength is fully determined by four flat ratings. */
function clubWith(
  id: string,
  attack: number,
  defence: number,
  overrides: Partial<Club> = {},
): Club {
  // Build a squad that lands on the requested attack/defence ratings: the
  // strength function reads the starting XI, so we make every outfielder equal
  // to `attack` and every defender/keeper equal to `defence`.
  const players = [
    ...Array.from({ length: 1 }, (_, i) => ({
      id: `${id}-gk${i}`,
      name: `Keeper ${i}`,
      position: "GK" as const,
      age: 27,
      ability: defence,
      wage: 500,
      value: 10_000,
      morale: 70,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `${id}-df${i}`,
      name: `Defender ${i}`,
      position: "DF" as const,
      age: 27,
      ability: defence,
      wage: 500,
      value: 10_000,
      morale: 70,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `${id}-mf${i}`,
      name: `Midfielder ${i}`,
      position: "MF" as const,
      age: 27,
      ability: attack,
      wage: 500,
      value: 10_000,
      morale: 70,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `${id}-fw${i}`,
      name: `Forward ${i}`,
      position: "FW" as const,
      age: 27,
      ability: attack,
      wage: 500,
      value: 10_000,
      morale: 70,
    })),
  ];

  return {
    id,
    name: id,
    short: id.slice(0, 3).toUpperCase(),
    tier: 5,
    colors: { primary: "#0a1b13", secondary: "#c8f751" },
    capacity: 5_000,
    balance: 100_000,
    ticketPrice: 10,
    fanMood: 60,
    players,
    ...overrides,
  };
}

function simulateMany(
  home: Club,
  away: Club,
  count: number,
  mentality: Mentality = "balanced",
) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (let seed = 1; seed <= count; seed++) {
    const match = simulateMatch({ home, away, seed, mentality });
    if (match.homeGoals > match.awayGoals) homeWins++;
    else if (match.homeGoals === match.awayGoals) draws++;
    else awayWins++;
  }
  return { homeWins, draws, awayWins };
}

describe("match simulation", () => {
  it("lets a much stronger side win at least 70% of 200 matches", () => {
    const strong = clubWith("strong", 85, 85);
    const weak = clubWith("weak", 45, 45);

    const { homeWins } = simulateMany(strong, weak, 200);

    expect(homeWins / 200).toBeGreaterThanOrEqual(0.7);
  });

  it("gives identical sides a home win rate between 35% and 60%", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    const { homeWins } = simulateMany(home, away, 400);

    expect(homeWins / 400).toBeGreaterThanOrEqual(0.35);
    expect(homeWins / 400).toBeLessThanOrEqual(0.6);
  });

  it("scores fewer goals on average when cautious than when attacking", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    // Per-seed monotonicity is not a real property of two Poisson draws sharing
    // a stream: one seed can produce 3 goals cautious and 2 attacking. The
    // property that matters is the expected total, so compare means.
    const mean = (mentality: "cautious" | "attacking") => {
      let total = 0;
      const runs = 400;
      for (let seed = 1; seed <= runs; seed++) {
        const match = simulateMatch({ home, away, seed, mentality });
        total += match.homeGoals + match.awayGoals;
      }
      return total / runs;
    };

    expect(mean("cautious")).toBeLessThan(mean("attacking"));
  });

  it("keeps goals, scorers and the result consistent", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    for (let seed = 1; seed <= 50; seed++) {
      const match = simulateMatch({ home, away, seed });

      expect(match.scorers.home).toHaveLength(match.homeGoals);
      expect(match.scorers.away).toHaveLength(match.awayGoals);

      const expected =
        match.homeGoals > match.awayGoals
          ? "home"
          : match.homeGoals < match.awayGoals
            ? "away"
            : "draw";
      expect(match.result).toBe(expected);
    }
  });

  it("is deterministic for the same seed and inputs", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    const a = simulateMatch({ home, away, seed: 12345 });
    const b = simulateMatch({ home, away, seed: 12345 });

    expect(b.homeGoals).toBe(a.homeGoals);
    expect(b.awayGoals).toBe(a.awayGoals);
    expect(b.scorers).toEqual(a.scorers);
  });

  it("produces more than one scoreline across different seeds", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    const scorelines = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const match = simulateMatch({ home, away, seed: i + 1 });
        return `${match.homeGoals}-${match.awayGoals}`;
      }),
    );

    expect(scorelines.size).toBeGreaterThan(1);
  });

  it("reports the strengths it actually used", () => {
    const home = clubWith("home", 70, 55);
    const away = clubWith("away", 50, 65);
    const match = simulateMatch({ home, away, seed: 7 });

    expect(match.homeStrength).toEqual(computeStrength(home));
    expect(match.awayStrength).toEqual(computeStrength(away));
  });

  it("lets the away manager's pick change the match on its own", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    // In a friend league both benches pick. If only the home pick were read,
    // these two away shapes would produce identical expected goals — and any
    // single seed can coincide, so compare means over a run.
    const mean = (awayMentality: Mentality, field: "scored" | "conceded") => {
      let total = 0;
      const runs = 200;
      for (let seed = 1; seed <= runs; seed++) {
        const match = simulateMatch({
          home,
          away,
          seed,
          mentality: "balanced",
          awayMentality,
        });
        total += field === "scored" ? match.awayGoals : match.homeGoals;
      }
      return total / runs;
    };

    expect(mean("cautious", "scored")).toBeLessThan(mean("attacking", "scored"));
    expect(mean("cautious", "conceded")).toBeLessThan(
      mean("attacking", "conceded"),
    );
  });

  it("defaults the away pick to the home pick, so old calls still mean one tactic", () => {
    const home = clubWith("home", 60, 60);
    const away = clubWith("away", 60, 60);

    const onePick = simulateMatch({ home, away, seed: 4, mentality: "attacking" });
    const bothPicks = simulateMatch({
      home,
      away,
      seed: 4,
      mentality: "attacking",
      awayMentality: "attacking",
    });

    expect(bothPicks).toEqual(onePick);
  });
});
