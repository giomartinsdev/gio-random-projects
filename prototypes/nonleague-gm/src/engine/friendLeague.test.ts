import { describe, expect, it } from "vitest";

import {
  claimClub,
  createFriendLeague,
  friendStandings,
  headToHead,
  leagueCode,
  mentalityFor,
  recordMatchday,
  recordSeason,
  resolveMatchday,
  submit,
  takeover,
  waitingOn,
  windowState,
} from "./friendLeague";
import type { TableRow } from "./types";

const SIX = [
  { id: "m-gio", name: "Gio", clubId: "ash" },
  { id: "m-dan", name: "Dan", clubId: "upp" },
  { id: "m-priya", name: "Priya", clubId: "mar" },
  { id: "m-tom", name: "Tom", clubId: "net" },
  { id: "m-aisha", name: "Aisha", clubId: "wex" },
  { id: "m-callum", name: "Callum", clubId: "bra" },
];

function league(members = SIX) {
  const [commissioner, ...rivals] = members;
  return createFriendLeague({
    name: "The Sunday Lads",
    commissioner,
    rivals,
  });
}

function row(clubId: string, points: number, played = 31): TableRow {
  return {
    clubId,
    played,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points,
  };
}

function everyoneBut(members = SIX) {
  let result = league(members);
  for (const member of members.slice(0, -1)) {
    result = submit(result, member.id, "balanced");
  }
  return result;
}

describe("creating a friend league", () => {
  it("refuses a league of one, because that is just a career", () => {
    expect(() =>
      createFriendLeague({
        name: "The Sunday Lads",
        commissioner: SIX[0],
      }),
    ).toThrow(/two managers/i);
  });

  it("refuses two managers on the same club", () => {
    expect(() =>
      createFriendLeague({
        name: "The Sunday Lads",
        commissioner: SIX[0],
        rivals: [{ id: "m-dan", name: "Dan", clubId: "ash" }],
      }),
    ).toThrow(/taken|same club/i);
  });

  it("refuses duplicate manager names, because the table would be a lie", () => {
    expect(() =>
      createFriendLeague({
        name: "The Sunday Lads",
        commissioner: SIX[0],
        rivals: [{ id: "m-two", name: "gio", clubId: "upp" }],
      }),
    ).toThrow(/unique/i);
  });

  it("issues a readable, stable invite code", () => {
    const code = leagueCode("The Sunday Lads");

    expect(code).toMatch(/^PYR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(leagueCode("The Sunday Lads")).toBe(code);
    expect(leagueCode("The Monday Lads")).not.toBe(code);
  });

  it("starts collecting on matchday one with nobody ready", () => {
    const created = league();

    expect(created.matchday).toBe(1);
    expect(created.members).toHaveLength(6);
    expect(windowState(created)).toBe("collecting");
    expect(waitingOn(created)).toHaveLength(6);
  });
});

describe("the matchday window", () => {
  it("locks only when every active manager has submitted", () => {
    const five = everyoneBut();

    expect(windowState(five)).toBe("collecting");
    expect(waitingOn(five)).toHaveLength(1);
    expect(waitingOn(five)[0].name).toBe("Callum");

    const six = submit(five, "m-callum", "attacking");
    expect(windowState(six)).toBe("locked");
    expect(mentalityFor(six, "bra")).toBe("attacking");
  });

  it("will not resolve early, and names who it is waiting on", () => {
    const five = everyoneBut();

    expect(() => resolveMatchday(five)).toThrow(/Callum/);
    expect(five.matchday).toBe(1);
  });

  it("advances for everyone once locked, and clears the picks", () => {
    const six = submit(everyoneBut(), "m-callum", "cautious");

    const { league: next, autoSimmed } = resolveMatchday(six);

    expect(next.matchday).toBe(2);
    expect(next.picks).toEqual({});
    expect(autoSimmed).toHaveLength(0);
    expect(windowState(next)).toBe("collecting");
  });

  it("simulates a no-show rather than freezing the league", () => {
    const five = everyoneBut();

    const { league: next, autoSimmed } = resolveMatchday(five, { force: true });

    expect(autoSimmed.map((m) => m.name)).toEqual(["Callum"]);
    expect(next.matchday).toBe(2);
    expect(next.members.find((m) => m.id === "m-callum")?.misses).toBe(1);
    expect(next.members.find((m) => m.id === "m-callum")?.status).toBe("active");
  });

  it("does not punish a manager who did submit when someone else no-shows", () => {
    const five = everyoneBut();
    const { league: next } = resolveMatchday(five, { force: true });

    expect(next.members.find((m) => m.id === "m-gio")?.misses).toBe(0);
  });

  it("hands the club to a caretaker after three misses", () => {
    let current = league();
    for (let i = 0; i < 3; i++) {
      current = resolveMatchday(current, { force: true }).league;
    }

    const callum = current.members.find((m) => m.id === "m-callum");
    expect(callum?.misses).toBe(3);
    expect(callum?.status).toBe("idle");

    // The league keeps moving without him.
    expect(current.matchday).toBe(4);
    expect(() => resolveMatchday(current, { force: true })).not.toThrow();
  });

  it("refuses a submission from a club under a caretaker", () => {
    let current = league();
    for (let i = 0; i < 3; i++) {
      current = resolveMatchday(current, { force: true }).league;
    }

    expect(() => submit(current, "m-callum", "attacking")).toThrow(/caretaker/i);
  });

  it("lets a new manager take over a caretaker club, record intact", () => {
    let current = league();
    for (let i = 0; i < 3; i++) {
      current = resolveMatchday(current, { force: true }).league;
    }

    const adopted = takeover(current, "m-callum", "Sophie");
    const sophie = adopted.members.find((m) => m.id === "m-callum");

    expect(sophie?.name).toBe("Sophie");
    expect(sophie?.status).toBe("active");
    expect(sophie?.misses).toBe(0);
    expect(sophie?.clubId).toBe("bra");
  });
});

describe("clubs", () => {
  it("can be claimed before kick-off", () => {
    const claimed = claimClub(league(), "m-gio", "kes");

    expect(claimed.members.find((m) => m.id === "m-gio")?.clubId).toBe("kes");
  });

  it("cannot be swapped once a matchday has been played", () => {
    let current = league();
    current = recordMatchday(current, 2026, 1, [
      {
        season: 2026,
        week: 1,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 2,
        awayGoals: 1,
      },
    ]);

    expect(() => claimClub(current, "m-gio", "kes")).toThrow(/locked/i);
  });
});

describe("head-to-head", () => {
  it("counts only matches between two managers", () => {
    let current = league();
    current = recordMatchday(current, 2026, 1, [
      {
        season: 2026,
        week: 1,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 2,
        awayGoals: 1,
      },
      {
        season: 2026,
        week: 1,
        homeClubId: "ash",
        awayClubId: "ai-club",
        homeGoals: 6,
        awayGoals: 0,
      },
    ]);

    const vsDan = headToHead(current, "m-gio").find((h) => h.opponentId === "m-dan");

    expect(vsDan?.played).toBe(1);
    expect(vsDan?.won).toBe(1);
    expect(vsDan?.points).toBe(3);
    expect(vsDan?.goalsFor).toBe(2);
  });

  it("keeps totals across seasons and reports the latest meeting", () => {
    let current = league();
    current = recordMatchday(current, 2025, 34, [
      {
        season: 2025,
        week: 34,
        homeClubId: "upp",
        awayClubId: "ash",
        homeGoals: 3,
        awayGoals: 0,
      },
    ]);
    current = recordMatchday(current, 2026, 12, [
      {
        season: 2026,
        week: 12,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 1,
        awayGoals: 1,
      },
    ]);

    const vsDan = headToHead(current, "m-gio").find((h) => h.opponentId === "m-dan");

    expect(vsDan?.played).toBe(2);
    expect(vsDan?.won).toBe(0);
    expect(vsDan?.drawn).toBe(1);
    expect(vsDan?.lost).toBe(1);
    expect(vsDan?.points).toBe(1);
    expect(vsDan?.last).toEqual({ season: 2026, week: 12, score: "1–1" });
  });

  it("ranks opponents by the points won against them", () => {
    let current = league();
    current = recordMatchday(current, 2026, 1, [
      {
        season: 2026,
        week: 1,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 0,
        awayGoals: 2,
      },
    ]);
    current = recordMatchday(current, 2026, 2, [
      {
        season: 2026,
        week: 2,
        homeClubId: "ash",
        awayClubId: "mar",
        homeGoals: 4,
        awayGoals: 0,
      },
    ]);

    const table = headToHead(current, "m-gio");

    expect(table[0].opponentName).toBe("Priya");
    expect(table[0].points).toBe(3);
    // A rival you have met outranks one you have not, even on zero points.
    expect(table[1].opponentName).toBe("Dan");
    expect(table.slice(2).every((entry) => entry.played === 0)).toBe(true);
  });

  it("does not count the same derby twice when a matchday is replayed", () => {
    const derby = {
      season: 2026,
      week: 1,
      homeClubId: "ash",
      awayClubId: "upp",
      homeGoals: 2,
      awayGoals: 1,
    };

    let current = league();
    current = recordMatchday(current, 2026, 1, [derby]);
    // A double-clicked "play matchday" must not turn one meeting into two.
    current = recordMatchday(current, 2026, 1, [derby]);

    const vsDan = headToHead(current, "m-gio").find((h) => h.opponentId === "m-dan");

    expect(current.results).toHaveLength(1);
    expect(vsDan?.played).toBe(1);
  });

  it("ignores result rows dated to a different season or week", () => {
    const current = recordMatchday(league(), 2026, 4, [
      {
        season: 2025,
        week: 4,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 5,
        awayGoals: 0,
      },
      {
        season: 2026,
        week: 5,
        homeClubId: "ash",
        awayClubId: "upp",
        homeGoals: 0,
        awayGoals: 5,
      },
    ]);

    // Wrong date means wrong archive: neither row belongs to matchday 4 of 2026.
    expect(current.results).toHaveLength(0);
  });
});

describe("the friend table", () => {
  it("ranks managers by tier first, then league position", () => {
    const current = league();
    const rows = [
      row("net", 46),
      row("mar", 45),
      row("ash", 43),
      row("wex", 41),
      row("upp", 35),
      row("bra", 23),
    ];

    const table = friendStandings(current, rows, 6);

    expect(table.map((entry) => entry.managerName)).toEqual([
      "Tom",
      "Priya",
      "Gio",
      "Aisha",
      "Dan",
      "Callum",
    ]);
    expect(table[0].position).toBe(1);
  });

  it("puts a manager in the division above ahead of a lower-division winner", () => {
    const current = league();
    const lower = friendStandings(current, [row("net", 70)], 6);
    expect(lower[0].tier).toBe(6);

    const mixed = friendStandings(
      { ...current, members: current.members.slice(0, 2) },
      [row("ash", 40), row("upp", 55)],
      5,
    );

    expect(mixed[0].tier).toBe(5);
  });

  it("still lists a club that is not in the current table, at the bottom", () => {
    const current = league();
    const table = friendStandings(current, [row("net", 46)], 6);

    expect(table).toHaveLength(6);
    expect(table[table.length - 1].played).toBe(0);
  });
});

describe("honours", () => {
  it("crowns the manager highest up the pyramid, not the highest points", () => {
    const current = league();
    const crowned = recordSeason(current, 2026, [
      { managerId: "m-gio", tier: 5, position: 3, points: 71 },
      { managerId: "m-tom", tier: 6, position: 1, points: 88 },
    ]);

    expect(crowned.honours).toHaveLength(1);
    expect(crowned.honours[0].managerName).toBe("Gio");
    expect(crowned.honours[0].tier).toBe(5);
  });

  it("refuses to crown the same season twice", () => {
    const crowned = recordSeason(league(), 2026, [
      { managerId: "m-gio", tier: 6, position: 1, points: 80 },
      { managerId: "m-tom", tier: 6, position: 2, points: 79 },
    ]);

    expect(() =>
      recordSeason(crowned, 2026, [
        { managerId: "m-tom", tier: 6, position: 1, points: 80 },
      ]),
    ).toThrow(/already/i);
  });
});
