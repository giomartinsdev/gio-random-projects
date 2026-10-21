import { describe, expect, it } from "vitest";

import { samplePitch, TOTAL_MINUTES } from "./pitch";
import { simulateMatch } from "./match";
import { createClubs } from "./data";
import { Rng } from "./rng";

const clubs = createClubs(new Rng(20260820), 6, 7);
const home = clubs[0];
const away = clubs[1];

const result = simulateMatch({ home, away, seed: 42, fixtureId: "fx-01" });

describe("2D pitch model", () => {
  it("puts twenty-two players on the pitch at any minute", () => {
    for (const minute of [0, 1, 17, 45, 63, 90]) {
      const frame = samplePitch({ result, minute, seed: 42 });
      expect(frame.players).toHaveLength(22);
      expect(frame.players.filter((p) => p.side === "home")).toHaveLength(11);
      expect(frame.players.filter((p) => p.side === "away")).toHaveLength(11);
      expect(new Set(frame.players.map((p) => p.id)).size).toBe(22);
    }
  });

  it("keeps every player and the ball inside the pitch at any minute", () => {
    // The renderer clips; a token at 1.02 would be silently cut in half.
    for (let minute = 0; minute <= TOTAL_MINUTES; minute++) {
      const frame = samplePitch({ result, minute, seed: 42 });
      for (const p of frame.players) {
        expect(p.x).toBeGreaterThanOrEqual(0.02);
        expect(p.x).toBeLessThanOrEqual(0.98);
        expect(p.y).toBeGreaterThanOrEqual(0.04);
        expect(p.y).toBeLessThanOrEqual(0.96);
      }
      expect(frame.ball.x).toBeGreaterThanOrEqual(0.01);
      expect(frame.ball.x).toBeLessThanOrEqual(0.99);
      expect(frame.ball.y).toBeGreaterThanOrEqual(0.03);
      expect(frame.ball.y).toBeLessThanOrEqual(0.97);
    }
  });

  it("is deterministic — the same match never plays out differently", () => {
    const a = samplePitch({ result, minute: 63, seed: 42 });
    const b = samplePitch({ result, minute: 63, seed: 42 });

    expect(a.ball).toEqual(b.ball);
    expect(a.players).toEqual(b.players);
  });

  it("actually moves — minute 20 is not minute 21", () => {
    const a = samplePitch({ result, minute: 20, seed: 42 });
    const b = samplePitch({ result, minute: 21, seed: 42 });

    const moved = a.players.filter((p, i) => {
      const q = b.players[i];
      return Math.abs(p.x - q.x) > 1e-4 || Math.abs(p.y - q.y) > 1e-4;
    });
    expect(moved.length).toBeGreaterThan(10);
    expect(a.ball).not.toEqual(b.ball);
  });

  it("never lets two tokens overlap on screen", () => {
    // Normalised distance is the wrong test: the pitch is 956x664, so 0.02
    // across is 19px but 0.02 up is only 13px — two players can satisfy a
    // circular check and still sit on top of each other. Measure in token
    // radii instead, which is what the eye sees.
    const TOKEN_X = 0.030;
    const TOKEN_Y = 0.052;

    for (const minute of [12, 30, 55, 74, 88]) {
      const frame = samplePitch({ result, minute, seed: 42 });
      for (let i = 0; i < frame.players.length; i++) {
        for (let j = i + 1; j < frame.players.length; j++) {
          const dx = (frame.players[i].x - frame.players[j].x) / TOKEN_X;
          const dy = (frame.players[i].y - frame.players[j].y) / TOKEN_Y;
          expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("gives each side eleven distinct shirt numbers", () => {
    const frame = samplePitch({ result, minute: 30, seed: 42 });
    const homeNumbers = frame.players.filter((p) => p.side === "home").map((p) => p.number);
    const awayNumbers = frame.players.filter((p) => p.side === "away").map((p) => p.number);

    expect(new Set(homeNumbers).size).toBe(11);
    expect(new Set(awayNumbers).size).toBe(11);
    expect(homeNumbers).toContain(1);
    expect(awayNumbers).toContain(1);
  });

  it("clamps a minute outside the match to the touchlines of the 90", () => {
    const before = samplePitch({ result, minute: -10, seed: 42 });
    const atZero = samplePitch({ result, minute: 0, seed: 42 });
    const after = samplePitch({ result, minute: 200, seed: 42 });
    const atNinety = samplePitch({ result, minute: TOTAL_MINUTES, seed: 42 });

    expect(before.ball).toEqual(atZero.ball);
    expect(after.ball).toEqual(atNinety.ball);
  });

  it("moves the ball toward the side that scored when a goal goes in", () => {
    // Sanity on the narrative, not the pixels: right after a home goal the ball
    // restarts near the centre, having come from the attacking third.
    const atMinute = (m: number) => samplePitch({ result, minute: m, seed: 42 });
    const spread = [30, 40, 50, 60, 70, 80].map((m) => atMinute(m).ball.x);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(0.1);
  });
});
