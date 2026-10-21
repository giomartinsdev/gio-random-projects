import { describe, expect, it } from "vitest";

import { createCareer, advanceWeek, finishSeason } from "@/engine/career";
import {
  fromSnapshot,
  kitFor,
  loadDataset,
  parseSnapshot,
  shortCode,
  type Snapshot,
} from "@/engine/dataset";
import { appearanceOf, attributesOf, crestOf, positionLabel, shirtNumber } from "@/engine/identity";

/**
 * The identity layer and the data adapter.
 *
 * These are the two pieces that let the game look like a football game instead of
 * a dashboard: a stable appearance per player, and a real league when one is
 * supplied. Both are pure, so both are cheap to pin down here.
 */

describe("player identity", () => {
  it("gives the same player the same face every time", () => {
    const first = appearanceOf("p-0-7", 27);
    const second = appearanceOf("p-0-7", 27);
    expect(first).toEqual(second);
  });

  it("gives different players different faces", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p-0-${i}`);
    const signatures = new Set(ids.map((id) => JSON.stringify(appearanceOf(id, 26))));
    // Twenty players in a squad should not be twenty clones.
    expect(signatures.size).toBeGreaterThanOrEqual(14);
  });

  it("ages a player's look: veterans lose the hairline", () => {
    const young = appearanceOf("p-3-9", 20);
    const old = appearanceOf("p-3-9", 36);
    expect(["crop", "buzz", "bald", "fade"]).toContain(old.hairStyle);
    expect(old.beard).not.toBe("none");
    expect(young).not.toEqual(old);
  });

  it("keeps shirt numbers unique across a squad", () => {
    const numbers = Array.from({ length: 20 }, (_, i) => shirtNumber(i));
    expect(new Set(numbers).size).toBe(20);
    expect(numbers[0]).toBe(1);
  });

  it("derives six attributes that stay near the one real rating", () => {
    const player = { id: "p-1-4", position: "MF" as const, ability: 68 };
    const attributes = attributesOf(player);
    const values = Object.values(attributes);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    expect(values.every((v) => v >= 20 && v <= 99)).toBe(true);
    // The card must not claim a 68 is a 91, or the pitch would contradict it.
    expect(Math.abs(mean - 68)).toBeLessThan(9);
  });

  it("shapes attributes by position", () => {
    const keeper = attributesOf({ id: "p-1-0", position: "GK", ability: 70 });
    const striker = attributesOf({ id: "p-1-17", position: "FW", ability: 70 });
    expect(keeper.defending).toBeGreaterThan(keeper.shooting);
    expect(striker.shooting).toBeGreaterThan(striker.defending);
  });

  it("labels a player with a real position, not just GK/DF/MF/FW", () => {
    const labels = new Set(
      Array.from({ length: 40 }, (_, i) =>
        positionLabel({ id: `p-9-${i}`, position: (["DF", "MF", "FW"] as const)[i % 3] }),
      ),
    );
    expect(labels.size).toBeGreaterThan(4);
  });

  it("gives every club a crest design from its own colours", () => {
    const first = crestOf("club-5-1", { primary: "#123", secondary: "#456" }, "ASH");
    const again = crestOf("club-5-1", { primary: "#123", secondary: "#456" }, "ASH");
    expect(first).toEqual(again);
    expect(first.code).toBe("ASH");
    expect(["band", "stripes", "halves", "chevron", "hoops"]).toContain(first.pattern);
  });
});

function snapshotOf(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    meta: {
      source: "api-football",
      leagueId: 43,
      leagueName: "National League",
      season: 2025,
      fetchedAt: "2026-08-01T00:00:00.000Z",
      provider: "API-Football",
    },
    teams: [
      {
        team: { id: 101, name: "Dulwich Hamlet", code: "DUL", logo: "https://media.example/101.png" },
        venue: { name: "Champion Hill", capacity: 3000 },
        squad: Array.from({ length: 18 }, (_, i) => ({
          id: 1000 + i,
          name: `Player ${i}`,
          age: 20 + (i % 12),
          number: i + 1,
          position: i === 0 ? "Goalkeeper" : i < 7 ? "Defender" : i < 13 ? "Midfielder" : "Attacker",
          photo: `https://media.example/p${1000 + i}.png`,
        })),
      },
      {
        team: { id: 102, name: "Torquay United", code: null, logo: null },
        venue: null,
        squad: Array.from({ length: 11 }, (_, i) => ({
          id: 2000 + i,
          name: `Gull ${i}`,
          age: 24,
          number: null,
          position: null,
          photo: null,
        })),
      },
    ],
    ...overrides,
  };
}

describe("licensed data", () => {
  it("keeps real names, crests and portraits", () => {
    const dataset = fromSnapshot(snapshotOf());
    const club = dataset.clubs[0];

    expect(club.name).toBe("Dulwich Hamlet");
    expect(club.crestUrl).toBe("https://media.example/101.png");
    expect(club.venue).toBe("Champion Hill");
    expect(club.players[0].photoUrl).toBe("https://media.example/p1000.png");
    expect(club.players.length).toBe(18);
  });

  it("renders clubs without a crest or colours from the club id", () => {
    const dataset = fromSnapshot(snapshotOf());
    const bare = dataset.clubs[1];

    expect(bare.name).toBe("Torquay United");
    expect(bare.crestUrl).toBeUndefined();
    // A kit is still derived, so the badge and the 2D token have a colour.
    expect(bare.colors.primary).toBe(kitFor(102).primary);
  });

  it("copes with a squad the provider sent without positions", () => {
    const dataset = fromSnapshot(snapshotOf());
    const squad = dataset.clubs[1].players;

    expect(squad.some((p) => p.position === "GK")).toBe(true);
    expect(squad.every((p) => ["GK", "DF", "MF", "FW"].includes(p.position))).toBe(true);
  });

  it("gives the best player in a squad the highest rating", () => {
    const dataset = fromSnapshot(snapshotOf());
    const squad = dataset.clubs[0].players;
    expect(squad[0].ability).toBeGreaterThan(squad[squad.length - 1].ability);
  });

  it("derives three-letter codes when the provider has none", () => {
    expect(shortCode("Torquay United", null)).toBe("TOR");
    expect(shortCode("Dulwich Hamlet", "DUL")).toBe("DUL");
    expect(shortCode("AFC Fylde", null)).toBe("FYL");
  });

  it("rejects a file that is not a snapshot", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ meta: { source: "other" }, teams: [] })).toBeNull();
    expect(parseSnapshot({ meta: { source: "api-football" }, teams: [{ team: { name: "X" }, squad: [] }] })).toBeNull();
  });

  it("starts a career in a licensed world without regenerating it", () => {
    const dataset = fromSnapshot(snapshotOf());
    const career = createCareer({
      seed: 42,
      clubs: dataset.clubs,
      source: "licensed",
      dataProvider: dataset.meta.provider,
      divisions: 1,
    });

    expect(career.source).toBe("licensed");
    expect(Object.values(career.clubs).map((c) => c.name).sort()).toEqual([
      "Dulwich Hamlet",
      "Torquay United",
    ]);
  });

  it("drops a club rather than starting a division with an odd number", () => {
    // 23 clubs cannot be paired; the fixture generator would throw at startup,
    // which is the worst possible moment to discover a data problem.
    const snapshot = snapshotOf();
    snapshot.teams.push({
      team: { id: 103, name: "Odd Club", code: null, logo: null },
      venue: null,
      squad: snapshot.teams[1].squad,
    });

    const career = createCareer({
      seed: 7,
      clubs: fromSnapshot(snapshot).clubs,
      source: "licensed",
      divisions: 1,
    });

    expect(Object.keys(career.clubs)).toHaveLength(2);
  });

  it("keeps the real clubs when a licensed season ends", () => {
    const dataset = fromSnapshot(snapshotOf());
    let career = createCareer({
      seed: 42,
      clubs: dataset.clubs,
      source: "licensed",
      divisions: 1,
    });

    // Play the season out, then close it. Regenerating clubs here would replace
    // the real division with invented names the moment the final whistle went.
    for (let i = 0; i < 400 && !career.seasonComplete; i++) {
      career = advanceWeek(career);
    }
    expect(career.seasonComplete).toBe(true);

    const next = finishSeason(career);
    const names = Object.values(next.clubs).map((c) => c.name).sort();
    expect(names).toEqual(["Dulwich Hamlet", "Torquay United"]);
  });
});

describe("loading a snapshot", () => {
  it("returns null when the deployment has no file", async () => {
    const original = globalThis.fetch;
    // A 404 is the normal case for a build that ships without a licence.
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    try {
      expect(await loadDataset()).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns null instead of throwing when the file is malformed", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{ this is not json", { status: 200 })) as typeof fetch;
    try {
      expect(await loadDataset()).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns null when the network is down", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      expect(await loadDataset()).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("loads a valid snapshot into the game's model", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(snapshotOf()), { status: 200 })) as typeof fetch;
    try {
      const dataset = await loadDataset();
      expect(dataset?.clubs.map((c) => c.name)).toEqual(["Dulwich Hamlet", "Torquay United"]);
      expect(dataset?.meta.provider).toBe("API-Football");
    } finally {
      globalThis.fetch = original;
    }
  });
});
