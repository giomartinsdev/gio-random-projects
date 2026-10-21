/**
 * Verifies the economy rewards a good season and punishes a bad one.
 *
 * A club that wins the league should end up meaningfully richer than one that
 * finishes bottom — otherwise the player has no financial reason to care about
 * results, and the whole management loop collapses into a spreadsheet.
 */
import { createCareer, advanceWeek, finishSeason } from "./career";
import { computeTable } from "./league";

function strongClub(career: ReturnType<typeof createCareer>): void {
  // Force the player's squad to be far better than the division.
  const club = career.clubs[career.playerClubId];
  club.players = club.players.map((p) => ({ ...p, ability: Math.min(95, p.ability + 30) }));
}

const rows: string[] = [];

for (const variant of ["weak", "baseline", "strong"] as const) {
  let career = createCareer({ seed: 424242, divisions: 5 });
  if (variant === "strong") strongClub(career);
  if (variant === "weak") {
    const club = career.clubs[career.playerClubId];
    club.players = club.players.map((p) => ({ ...p, ability: Math.max(20, p.ability - 18) }));
  }

  const start = career.clubs[career.playerClubId].balance;

  let guard = 0;
  while (!career.seasonComplete && guard < 200) {
    career = advanceWeek(career);
    guard++;
  }

  const table = computeTable(Object.values(career.clubs), career.fixtures);
  const row = table.find((r) => r.clubId === career.playerClubId);
  const position = table.findIndex((r) => r.clubId === career.playerClubId) + 1;
  const club = career.clubs[career.playerClubId];

  career = finishSeason(career);
  const end = career.clubs[career.playerClubId].balance;

  rows.push(
    `${variant.padEnd(9)} pos ${String(position).padStart(2)}  pts ${String(row?.points ?? 0).padStart(2)}  ` +
      `£${start.toLocaleString("en-GB")} → £${end.toLocaleString("en-GB")}  ` +
      `net ${(end - start) >= 0 ? "+" : ""}£${(end - start).toLocaleString("en-GB")}  ` +
      `tier ${club.tier} → ${career.clubs[career.playerClubId].tier}  ` +
      `outcome ${career.history[career.history.length - 1]?.outcome}`,
  );
}

console.log(rows.join("\n"));
console.log(
  "\nExpectation: strong finishes high and profits; weak finishes low and loses money.",
);
