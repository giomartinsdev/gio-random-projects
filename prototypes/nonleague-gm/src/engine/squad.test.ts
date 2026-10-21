import { describe, expect, it } from "vitest";

import { computeStrength, keyPlayers, pickLineup, starPlayer } from "./squad";
import type { Club, Player } from "./types";

function player(id: string, position: Player["position"], ability: number): Player {
  return {
    id,
    name: id,
    position,
    age: 26,
    ability,
    wage: 500,
    value: 10_000,
    morale: 70,
  };
}

function squad(): Player[] {
  return [
    player("gk", "GK", 70),
    player("df1", "DF", 50),
    player("df2", "DF", 80),
    player("df3", "DF", 60),
    player("df4", "DF", 55),
    player("df5", "DF", 65),
    player("mf1", "MF", 40),
    player("mf2", "MF", 90),
    player("mf3", "MF", 60),
    player("mf4", "MF", 58),
    player("mf5", "MF", 62),
    player("fw1", "FW", 30),
    player("fw2", "FW", 85),
    player("fw3", "FW", 55),
  ];
}

function clubWith(players: Player[]): Club {
  return {
    id: "c1",
    name: "Test",
    short: "TST",
    tier: 4,
    colors: { primary: "#000", secondary: "#fff" },
    capacity: 4_000,
    balance: 100_000,
    ticketPrice: 10,
    fanMood: 60,
    players,
  };
}

describe("the face a screen leads with", () => {
  it("picks the best outfielder, not the keeper", () => {
    const club = clubWith([...squad(), player("gk2", "GK", 99)]);
    const star = starPlayer(club);

    expect(star?.id).toBe("mf2"); // 90, the best non-keeper in the XI
    expect(star?.position).not.toBe("GK");
  });

  it("falls back to the keeper when that is all there is", () => {
    const club = clubWith([player("gk", "GK", 70)]);
    expect(starPlayer(club)?.id).toBe("gk");
  });

  it("returns undefined for an empty squad rather than throwing", () => {
    expect(starPlayer(clubWith([]))).toBeUndefined();
  });

  it("ranks key men by ability, best first", () => {
    const men = keyPlayers(clubWith(squad()), 3);
    expect(men.map((p) => p.id)).toEqual(["mf2", "fw2", "df2"]);
  });

  it("never asks for more key men than the XI holds", () => {
    expect(keyPlayers(clubWith(squad()), 99)).toHaveLength(11);
  });
});

describe("squad selection", () => {
  it("picks a valid 4-4-2 shape of eleven players", () => {
    const lineup = pickLineup(clubWith(squad()));

    expect(lineup).toHaveLength(11);

    const count = (position: Player["position"]) =>
      lineup.filter((p) => p.position === position).length;

    expect(count("GK")).toBe(1);
    expect(count("DF")).toBeGreaterThanOrEqual(3);
    expect(count("MF")).toBeGreaterThanOrEqual(3);
    expect(count("FW")).toBeGreaterThanOrEqual(1);
    expect(count("DF") + count("MF") + count("FW")).toBe(10);
  });

  it("prefers the highest-rated player available in each slot", () => {
    const lineup = pickLineup(clubWith(squad()));
    const ids = lineup.map((p) => p.id);

    expect(ids).toContain("df2");
    expect(ids).toContain("mf2");
    expect(ids).toContain("fw2");
    expect(ids).not.toContain("fw1");
  });

  it("fills every slot it can when a position is short", () => {
    // Seven defenders, no midfielders or forwards: the XI can only be as big as
    // the squad, but every available player must still be selected.
    const thin = [
      player("gk", "GK", 60),
      ...Array.from({ length: 10 }, (_, i) => player(`df${i}`, "DF", 50)),
    ];

    const lineup = pickLineup(clubWith(thin));

    expect(lineup).toHaveLength(11);
  });

  it("reports attack and defence strengths between 0 and 100", () => {
    const strength = computeStrength(clubWith(squad()));

    expect(strength.attack).toBeGreaterThan(0);
    expect(strength.attack).toBeLessThanOrEqual(100);
    expect(strength.defence).toBeGreaterThan(0);
    expect(strength.defence).toBeLessThanOrEqual(100);
  });

  it("rates a stronger squad higher", () => {
    const weak = clubWith(squad().map((p) => ({ ...p, ability: 40 })));
    const strong = clubWith(squad().map((p) => ({ ...p, ability: 80 })));

    expect(computeStrength(strong).attack).toBeGreaterThan(
      computeStrength(weak).attack,
    );
  });

  it("gives the same answer twice for the same squad", () => {
    const club = clubWith(squad());

    expect(computeStrength(club)).toEqual(computeStrength(club));
  });
});
