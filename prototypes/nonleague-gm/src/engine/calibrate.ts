/**
 * Calibration harness — not a test.
 *
 * Run with `npx tsx src/engine/calibrate.ts`. It prints the statistics the match
 * model actually produces, so tuning is evidence-based instead of vibes. If the
 * real-world numbers move (they do, slowly), this is the file to compare against.
 */
import { simulateMatch } from "./match";
import { computeStrength } from "./squad";
import type { Club, Player, Position } from "./types";

function squadWith(base: number): Player[] {
  const shape: Position[] = [
    "GK",
    "DF", "DF", "DF", "DF",
    "MF", "MF", "MF", "MF",
    "FW", "FW",
    "GK", "DF", "MF", "FW", "DF", "MF", "FW",
  ];
  return shape.map((position, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    position,
    age: 26,
    ability: base,
    wage: 400,
    value: 10_000,
    morale: 70,
  }));
}

function club(id: string, base: number): Club {
  return {
    id,
    name: id,
    short: id.slice(0, 3).toUpperCase(),
    tier: 5,
    colors: { primary: "#000", secondary: "#fff" },
    capacity: 5_000,
    balance: 100_000,
    ticketPrice: 10,
    fanMood: 60,
    players: squadWith(base),
  };
}

function report(label: string, home: Club, away: Club, runs = 2_000) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goals = 0;

  for (let seed = 1; seed <= runs; seed++) {
    const match = simulateMatch({ home, away, seed });
    goals += match.homeGoals + match.awayGoals;
    if (match.homeGoals > match.awayGoals) homeWins++;
    else if (match.homeGoals === match.awayGoals) draws++;
    else awayWins++;
  }

  const pct = (n: number) => ((n / runs) * 100).toFixed(1) + "%";

  console.log(
    `${label.padEnd(26)} home ${pct(homeWins).padStart(6)}  draw ${pct(draws).padStart(6)}  away ${pct(awayWins).padStart(6)}  goals/game ${(goals / runs).toFixed(2)}`,
  );
}

console.log(
  `strengths: even ${JSON.stringify(computeStrength(club("a", 60)))} vs ${JSON.stringify(computeStrength(club("b", 60)))}\n`,
);

report("even (60 v 60)", club("home", 60), club("away", 60));
report("10 pts stronger", club("home", 70), club("away", 60));
report("20 pts stronger", club("home", 80), club("away", 60));
report("30 pts stronger", club("home", 90), club("away", 60));

console.log(
  "\nReference, English league football: home ~45%, draw ~25%, away ~30%, ~2.7 goals/game.",
);
console.log(
  "Reference, mismatched cup tie: a 30-point gap should be near-certain, not 60%.",
);
