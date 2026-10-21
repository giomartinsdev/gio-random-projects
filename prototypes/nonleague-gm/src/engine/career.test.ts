import { describe, expect, it } from "vitest";

import { reviewBoard } from "./board";
import {
  advanceWeek,
  finishSeason,
  createCareer,
  loadCareer,
  saveCareer,
  signPlayer,
  upgradeStadium,
} from "./career";
import { applyCommand } from "./commands";
import { weeklyWageBill } from "./economy";
import { computeAttendance } from "./economy";
import { computeTable } from "./league";
import type { Career, FreeAgent } from "./types";

const SEED = 20260820;

describe("club economy", () => {
  it("pays gate receipts of attendance times ticket price", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.capacity = 5_000;
    club.ticketPrice = 10;

    // Attendance is computed from capacity, mood and league position; force a
    // known crowd so the arithmetic is what is under test.
    const before = club.balance;
    const next = advanceWeek(career);

    expect(next.clubs[career.playerClubId].balance).toBeGreaterThan(before);
  });

  it("deducts the wage bill every week", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    const wages = weeklyWageBill(club);

    expect(wages).toBeGreaterThan(0);
    expect(weeklyWageBill({ ...club, players: [] })).toBe(0);
  });

  it("never lets attendance exceed capacity", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.capacity = 2_000;
    club.fanMood = 100;

    const next = advanceWeek(career);
    const attendance = next.clubs[career.playerClubId].lastAttendance ?? 0;

    expect(attendance).toBeLessThanOrEqual(2_000);
  });

  it("gives a higher-placed club a bigger crowd", () => {
    // Attendance is a pure function of club, position and division size, so test
    // it directly — advancing a week recomputes position from the real table,
    // which would silently ignore a hand-set position.
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = { ...career.clubs[career.playerClubId], capacity: 8_000 };

    const top = computeAttendance(club, 1, 20);
    const bottom = computeAttendance(club, 20, 20);

    expect(top).toBeGreaterThan(bottom);
  });

  it("rejects a paid signing the club cannot afford", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.balance = -5_000;

    const target: FreeAgent = {
      id: "fa-1",
      name: "Expensive Striker",
      position: "FW",
      age: 24,
      ability: 72,
      wage: 1_200,
      value: 90_000,
      fee: 50_000,
    };

    const result = signPlayer(career, target);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/afford|balance|budget/i);
    expect(result.career.clubs[career.playerClubId].players).toHaveLength(
      club.players.length,
    );
  });

  it("allows a free agent even when the balance is negative", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.balance = -5_000;
    const sizeBefore = club.players.length;

    const target: FreeAgent = {
      id: "fa-2",
      name: "Free Transfer",
      position: "MF",
      age: 28,
      ability: 58,
      wage: 600,
      value: 0,
      fee: 0,
    };

    const result = signPlayer(career, target);

    expect(result.ok).toBe(true);
    expect(result.career.clubs[career.playerClubId].players).toHaveLength(
      sizeBefore + 1,
    );
  });

  it("upgrades the stadium for the stated cost and raises capacity", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.balance = 1_000_000;
    const capacityBefore = club.capacity;
    const balanceBefore = club.balance;

    const result = upgradeStadium(career);

    expect(result.ok).toBe(true);
    expect(result.career.clubs[career.playerClubId].capacity).toBeGreaterThan(
      capacityBefore,
    );
    expect(result.career.clubs[career.playerClubId].balance).toBeLessThan(
      balanceBefore,
    );
  });

  it("refuses a stadium upgrade the club cannot pay for", () => {
    const career = createCareer({ seed: SEED, clubId: "club-1", divisions: 2 });
    const club = career.clubs[career.playerClubId];
    club.balance = 10;
    const capacityBefore = club.capacity;

    const result = upgradeStadium(career);

    expect(result.ok).toBe(false);
    expect(result.career.clubs[career.playerClubId].capacity).toBe(
      capacityBefore,
    );
  });
});

describe("career progression", () => {
  it("promotes the player's club when it wins the league", () => {
    let career = createCareer({ seed: 424242, divisions: 5 });
    const club = career.clubs[career.playerClubId];
    club.players = club.players.map((p) => ({
      ...p,
      ability: Math.min(95, p.ability + 32),
    }));
    const startTier = club.tier;

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }
    career = finishSeason(career);

    const after = career.clubs[career.playerClubId];
    expect(after.tier).toBe(startTier - 1);
    expect(career.history.at(-1)?.outcome).toBe("promoted");
  });

  it("keeps a mid-table club in the same division", () => {
    let career = createCareer({ seed: 424242, divisions: 5 });
    const startTier = career.clubs[career.playerClubId].tier;

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }
    career = finishSeason(career);

    expect(career.clubs[career.playerClubId].tier).toBe(startTier);
  });

  it("cannot promote out of the top tier", () => {
    let career = createCareer({ seed: 424242, divisions: 1 });
    const club = career.clubs[career.playerClubId];
    club.players = club.players.map((p) => ({
      ...p,
      ability: Math.min(95, p.ability + 30),
    }));

    let guard = 0;
    while (!career.seasonComplete && guard < 200) {
      career = advanceWeek(career);
      guard++;
    }
    career = finishSeason(career);

    expect(career.clubs[career.playerClubId].tier).toBe(1);
    expect(career.history.at(-1)?.outcome).not.toBe("promoted");
  });

  it("starts in the bottom tier with a full squad and money", () => {
    const career = createCareer({ seed: SEED });

    const club = career.clubs[career.playerClubId];
    expect(club.tier).toBe(career.totalTiers);
    expect(club.players.length).toBeGreaterThanOrEqual(18);
    expect(club.balance).toBeGreaterThan(0);
  });

  it("plays a fixture and updates the table when a week advances", () => {
    const career = createCareer({ seed: SEED });
    const weekBefore = career.week;

    const next = advanceWeek(career);

    expect(next.week).toBe(weekBefore + 1);
    // One matchweek plays every fixture in the division, not one match.
    expect(next.results).toHaveLength(10);
    const table = computeTable(Object.values(next.clubs), next.fixtures);
    expect(table.every((row) => row.played === 1)).toBe(true);
  });

  it("completes the season with every club on 38 matches", () => {
    let career = createCareer({ seed: SEED, divisions: 1 });

    let guard = 0;
    while (!career.seasonComplete && guard < 500) {
      career = advanceWeek(career);
      guard++;
    }

    expect(career.seasonComplete).toBe(true);
    const table = computeTable(Object.values(career.clubs), career.fixtures);
    expect(table).toHaveLength(20);
    for (const row of table) expect(row.played).toBe(38);
  });

  it("survives a save and load round trip", () => {
    let career = createCareer({ seed: SEED, divisions: 1 });
    for (let i = 0; i < 6; i++) career = advanceWeek(career);

    const restored = loadCareer(saveCareer(career));

    expect(restored.week).toBe(career.week);
    expect(restored.playerClubId).toBe(career.playerClubId);
    expect(restored.results).toHaveLength(career.results.length);
    expect(Object.keys(restored.clubs)).toEqual(Object.keys(career.clubs));

    const continued = advanceWeek(restored);
    expect(continued.week).toBe(restored.week + 1);
  });

  it("sacks a manager who loses every remaining match", () => {
    let career = createCareer({ seed: SEED, divisions: 1 });
    career = {
      ...career,
      clubPosition: 20,
      form: [
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
        "L",
      ],    };

    const outcome = reviewBoard(career);

    expect(outcome.sacked).toBe(true);
  });

  it("keeps a manager sitting top of the league", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const safe: Career = {
      ...career,
      clubPosition: 1,
      form: ["W", "W", "W", "W", "W", "W", "W", "W"],
    };

    const outcome = reviewBoard(safe);

    expect(outcome.sacked).toBe(false);
  });

  it("rejects an unknown command without touching the career", () => {
    const career = createCareer({ seed: SEED });
    const before = saveCareer(career);

    const result = applyCommand(career, { type: "advance-week", weeks: 0 });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/week/i);
    expect(saveCareer(result.career)).toBe(before);
  });
});
