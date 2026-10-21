import { describe, expect, it } from "vitest";

import {
  computeAttendance,
  gateReceipts,
  prizeMoney,
  weeklyCommercial,
  weeklyCosts,
} from "./economy";
import { advanceWeek, createCareer, finishSeason } from "./career";
import { computeTable } from "./league";
import type { Club } from "./types";

function club(overrides: Partial<Club> = {}): Club {
  return {
    id: "c1",
    name: "Test",
    short: "TST",
    tier: 5,
    colors: { primary: "#000", secondary: "#fff" },
    capacity: 4_000,
    balance: 100_000,
    ticketPrice: 10,
    fanMood: 60,
    players: [
      {
        id: "p1",
        name: "A",
        position: "GK",
        age: 26,
        ability: 60,
        wage: 500,
        value: 10_000,
        morale: 70,
      },
    ],
    ...overrides,
  };
}

describe("commercial income", () => {
  it("pays a weekly commercial income", () => {
    expect(weeklyCommercial(club())).toBeGreaterThan(0);
  });

  it("pays more in a higher division", () => {
    expect(weeklyCommercial(club({ tier: 1 }))).toBeGreaterThan(
      weeklyCommercial(club({ tier: 5 })),
    );
  });

  it("pays more for a bigger ground", () => {
    expect(weeklyCommercial(club({ capacity: 8_000 }))).toBeGreaterThan(
      weeklyCommercial(club({ capacity: 2_000 })),
    );
  });

  it("never returns a negative or fractional amount", () => {
    const value = weeklyCommercial(club({ capacity: 0 }));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(value)).toBe(true);
  });
});

describe("prize money", () => {
  it("pays nothing for zero points", () => {
    expect(prizeMoney(0, 5)).toBe(0);
  });

  it("pays more for a higher division and more points", () => {
    expect(prizeMoney(60, 1)).toBeGreaterThan(prizeMoney(60, 5));
    expect(prizeMoney(80, 5)).toBeGreaterThan(prizeMoney(40, 5));
  });
});

describe("season solvency", () => {
  it("keeps a mid-table club solvent over a full season", () => {
    // The whole point: a club that is not promoted and not relegated should
    // roughly break even. Insolvency by default is a bug, not difficulty.
    let career = createCareer({ seed: 20260820, divisions: 5 });
    const start = career.clubs[career.playerClubId].balance;

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }
    career = finishSeason(career);

    const end = career.clubs[career.playerClubId].balance;
    expect(end).toBeGreaterThan(0);
    // Allow a bad season to hurt, but not to halve the club.
    expect(end).toBeGreaterThan(start * 0.5);
  });

  it("does not let a club bankroll itself into absurd wealth in one season", () => {
    let career = createCareer({ seed: 20260820, divisions: 5 });
    const start = career.clubs[career.playerClubId].balance;

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }
    career = finishSeason(career);

    const end = career.clubs[career.playerClubId].balance;
    expect(end).toBeLessThan(start * 6);
  });

  it("pays prize money once at the end of the season", () => {
    let career = createCareer({ seed: 20260820, divisions: 5 });

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }

    const before = career.clubs[career.playerClubId].balance;
    const table = computeTable(Object.values(career.clubs), career.fixtures);
    const row = table.find((r) => r.clubId === career.playerClubId);
    const expected = prizeMoney(row?.points ?? 0, 5);

    const after = finishSeason(career);

    // The new season keeps the balance; prize money is the only addition.
    expect(after.clubs[after.playerClubId].balance).toBeCloseTo(
      before + expected,
      -2,
    );
  });
});

describe("attendance and gate", () => {
  it("charges the ticket price for every spectator", () => {
    expect(gateReceipts(4_000, 10)).toBe(40_000);
    expect(gateReceipts(0, 10)).toBe(0);
  });

  it("never exceeds capacity even at maximum mood", () => {
    const full = club({ capacity: 2_000, fanMood: 100, ticketPrice: 1 });
    expect(computeAttendance(full, 1, 20)).toBeLessThanOrEqual(2_000);
  });

  it("keeps a hard core of support even when everything is wrong", () => {
    const bleak = club({ capacity: 5_000, fanMood: 0, ticketPrice: 40 });
    expect(computeAttendance(bleak, 20, 20)).toBeGreaterThan(0);
  });

  it("costs more each week than an empty club's overhead alone", () => {
    expect(weeklyCosts(club())).toBeGreaterThan(0);
  });
});
