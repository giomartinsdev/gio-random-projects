import { describe, expect, it } from "vitest";

import { GOAL_LINE, samplePitch, TOTAL_MINUTES } from "./pitch";
import { simulateMatch } from "./match";
import { createClubs } from "./data";
import { Rng } from "./rng";
import type { MatchResult } from "./types";

const clubs = createClubs(new Rng(20260820), 6, 7);
const home = clubs[0];
const away = clubs[1];

const result = simulateMatch({ home, away, seed: 42, fixtureId: "fx-01" });

/** A match with a known, deliberate scoreline so the ball can be asserted on. */
function fixedResult(scorers: { home: number[]; away: number[] }): MatchResult {
  return {
    ...result,
    homeGoals: scorers.home.length,
    awayGoals: scorers.away.length,
    scorers: {
      home: scorers.home.map((minute, i) => ({
        playerId: `h${i}`,
        playerName: `Home ${i}`,
        minute,
        side: "home" as const,
      })),
      away: scorers.away.map((minute, i) => ({
        playerId: `a${i}`,
        playerName: `Away ${i}`,
        minute,
        side: "away" as const,
      })),
    },
  };
}

describe("the ball behaves like a football", () => {
  it("is at the feet of the man carrying it", () => {
    const match = fixedResult({ home: [], away: [] });

    let checked = 0;
    for (let minute = 1; minute < TOTAL_MINUTES; minute += 0.25) {
      const frame = samplePitch({ result: match, minute, seed: 42 });
      if (frame.phase !== "carry") continue;

      const carrier = frame.players.find((p) => p.hasBall);
      expect(carrier, `no carrier at ${minute}'`).toBeDefined();

      // A carried ball is within a boot of the carrier, not across the pitch.
      const d = Math.hypot(frame.ball.x - carrier!.x, frame.ball.y - carrier!.y);
      expect(d).toBeLessThan(0.06);
      checked++;
    }

    expect(checked).toBeGreaterThan(10);
  });

  it("travels between two players during a pass, and leaves the ground", () => {
    const match = fixedResult({ home: [], away: [] });
    const lifts: number[] = [];
    let longest = 0;

    for (let minute = 0; minute < TOTAL_MINUTES; minute += 0.25) {
      const frame = samplePitch({ result: match, minute, seed: 42 });
      if (frame.phase !== "pass") continue;
      lifts.push(frame.lift);
      const carrier = frame.players.find((p) => p.hasBall);
      if (carrier) {
        const d = Math.hypot(frame.ball.x - carrier.x, frame.ball.y - carrier.y);
        if (d > longest) longest = d;
      }
    }

    expect(lifts.length).toBeGreaterThan(20);
    // Some passes are lofted; the ball is not glued to the grass.
    expect(Math.max(...lifts)).toBeGreaterThan(0.1);
    // And a pass genuinely covers ground rather than jiggling in place.
    expect(longest).toBeGreaterThan(0.04);
  });

  it("is inside the net on the minute a goal is scored", () => {
    const match = fixedResult({ home: [56], away: [] });

    const frame = samplePitch({ result: match, minute: 56, seed: 42 });

    expect(frame.phase).toBe("goal");
    expect(frame.celebration).toBe(true);
    // Ashcombe attack to the right, so the ball is past the right goal line.
    expect(frame.ball.x).toBeGreaterThan(0.94);
    // Between the posts, not behind the advertising boards.
    expect(frame.ball.y).toBeGreaterThan(0.42);
    expect(frame.ball.y).toBeLessThan(0.58);
    // And nobody is credited with the ball — it is in the goal.
    expect(frame.players.some((p) => p.hasBall)).toBe(false);
  });

  it("puts an away goal in the other net", () => {
    const match = fixedResult({ home: [], away: [23] });

    const frame = samplePitch({ result: match, minute: 23, seed: 42 });

    expect(frame.phase).toBe("goal");
    expect(frame.ball.x).toBeLessThan(0.06);
    expect(frame.ball.y).toBeGreaterThan(0.42);
    expect(frame.ball.y).toBeLessThan(0.58);
  });

  it("restarts from the centre spot after a goal", () => {
    const match = fixedResult({ home: [56], away: [] });

    // The goal is held for a couple of minutes, then play resumes at the centre.
    const restart = samplePitch({ result: match, minute: 58, seed: 42 });

    expect(restart.phase).not.toBe("goal");
    expect(restart.ball.x).toBeGreaterThan(0.4);
    expect(restart.ball.x).toBeLessThan(0.6);
    expect(restart.ball.y).toBeGreaterThan(0.3);
    expect(restart.ball.y).toBeLessThan(0.7);
  });

  it("never teleports: the ball's position is continuous in time", () => {
    const match = fixedResult({ home: [12, 56], away: [34, 78] });

    // Continuity is a property of the model, so it is measured at a fine step.
    // Dead-ball beats (kick-off, restart) legitimately place the ball on the
    // spot; open play must never jump.
    for (let minute = 0; minute < TOTAL_MINUTES; minute += 0.25) {
      const a = samplePitch({ result: match, minute, seed: 42 });
      const b = samplePitch({ result: match, minute: minute + 0.25, seed: 42 });
      const d = Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y);

      if (!b.dead) expect(d, `ball jumped at ${minute}'`).toBeLessThan(0.12);
    }
  });

  it("moves every player smoothly, not just the ball", () => {
    // The ball being continuous is not enough. If a token is positioned by
    // anything other than the ball — pinned to it while carrying, released when
    // possession changes — the player hops while the ball glides. This is the
    // test that caught exactly that: a 180px jump in a 70ms frame.
    const match = fixedResult({ home: [12, 56], away: [34, 78] });

    let worst = 0;
    let where = "";

    let previous = samplePitch({ result: match, minute: 0, seed: 42 }).players;

    for (let minute = 0.5; minute <= TOTAL_MINUTES; minute += 0.5) {
      const now = samplePitch({ result: match, minute, seed: 42 }).players;

      for (let i = 0; i < now.length; i++) {
        const d = Math.hypot(now[i].x - previous[i].x, now[i].y - previous[i].y);
        if (d > worst) {
          worst = d;
          where = `${now[i].id} at ${minute}'`;
        }
      }

      previous = now;
    }

    // A tenth of the pitch in half a match minute is a sprint. Anything more is
    // a token that was placed rather than moved.
    expect(worst, `a token jumped: ${where}`).toBeLessThan(0.1);
  });

  it("moves a plausible distance between renderer frames", () => {
    const match = fixedResult({ home: [12, 56], away: [34, 78] });

    // The UI advances half a match minute per tick. Even a long diagonal pass
    // should not cross more than a third of the pitch between two frames, or
    // the transition reads as a cut rather than a pass.
    for (let minute = 0; minute < TOTAL_MINUTES - 0.5; minute += 0.5) {
      const a = samplePitch({ result: match, minute, seed: 42 });
      const b = samplePitch({ result: match, minute: minute + 0.5, seed: 42 });
      const d = Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y);

      if (!b.dead) expect(d, `ball jumped at ${minute}'`).toBeLessThan(0.34);
    }
  });

  it("keeps the ball inside the pitch, including inside the net", () => {
    for (let minute = 0; minute <= TOTAL_MINUTES; minute++) {
      const frame = samplePitch({ result, minute, seed: 42 });
      expect(frame.ball.x).toBeGreaterThanOrEqual(0.01);
      expect(frame.ball.x).toBeLessThanOrEqual(0.99);
      expect(frame.ball.y).toBeGreaterThanOrEqual(0.03);
      expect(frame.ball.y).toBeLessThanOrEqual(0.97);
      expect(frame.lift).toBeGreaterThanOrEqual(0);
      expect(frame.lift).toBeLessThanOrEqual(1);
    }
  });

  it("gives the ball to the side that is attacking", () => {
    const match = fixedResult({ home: [56], away: [] });
    const before = samplePitch({ result: match, minute: 55.4, seed: 42 });

    // In the build-up to a home goal the home side has the ball.
    expect(before.possession).toBe("home");
  });

  it("is deterministically rewatchable", () => {
    for (const minute of [3, 17, 44, 56, 71, 90]) {
      const a = samplePitch({ result, minute, seed: 42 });
      const b = samplePitch({ result, minute, seed: 42 });
      expect(a.ball).toEqual(b.ball);
      expect(a.phase).toBe(b.phase);
      expect(a.players).toEqual(b.players);
    }
  });

  it("puts every goal of a busy match in the right net on its own minute", () => {
    // A goal every few minutes, including a pair a minute apart and one in the
    // first minute — the schedule is squeezed hardest at exactly these points.
    const minuteList = { home: [1, 12, 46, 47], away: [23, 56, 71, 89] };
    const match = fixedResult(minuteList);

    for (const [side, minutes] of [
      ["home", minuteList.home],
      ["away", minuteList.away],
    ] as const) {
      for (const minute of minutes) {
        const frame = samplePitch({ result: match, minute, seed: 42 });

        expect(frame.phase, `${side} goal at ${minute}'`).toBe("goal");
        expect(frame.celebration).toBe(true);

        if (side === "home") {
          expect(frame.ball.x).toBeGreaterThan(0.94);
        } else {
          expect(frame.ball.x).toBeLessThan(0.06);
        }

        expect(frame.ball.y).toBeGreaterThan(0.42);
        expect(frame.ball.y).toBeLessThan(0.58);
      }
    }
  });

  it("never stands still for two minutes", () => {
    // The failure this catches: a pass whose length is a few centimetres drawn
    // over three minutes, or a dribble that does not dribble. Either one looks
    // like the match has frozen while the clock runs.
    const match = fixedResult({ home: [], away: [] });

    const steps = 900;
    const path = Array.from({ length: steps + 1 }, (_, i) =>
      samplePitch({ result: match, minute: i / 10, seed: 42 }).ball,
    );

    const window = 20; // two minutes at a tenth of a minute per sample
    let least = Number.POSITIVE_INFINITY;
    let at = 0;

    for (let i = 0; i + window < path.length; i++) {
      let travel = 0;
      for (let j = i; j < i + window; j++) {
        travel += Math.hypot(path[j + 1].x - path[j].x, path[j + 1].y - path[j].y);
      }
      if (travel < least) {
        least = travel;
        at = i / 10;
      }
    }

    expect(least, `the ball barely moved for two minutes around ${at}'`).toBeGreaterThan(0.01);
  });

  it("keeps the ball out of the net on the minute *before* a goal", () => {    const match = fixedResult({ home: [56], away: [] });

    // The scoreboard still reads 0-0 at 55.9, so the ball must not be past the
    // line yet — otherwise the picture contradicts the score for a frame.
    const frame = samplePitch({ result: match, minute: 55.9, seed: 42 });
    expect(frame.celebration).toBe(false);
    expect(frame.ball.x).toBeLessThanOrEqual(1 - GOAL_LINE + 1e-6);
  });

  it("always has exactly one man on the ball, except in the net", () => {
    for (let minute = 0; minute <= TOTAL_MINUTES; minute += 0.5) {
      const frame = samplePitch({ result, minute, seed: 42 });
      const carriers = frame.players.filter((p) => p.hasBall).length;

      if (frame.celebration) {
        expect(carriers).toBe(0);
      } else {
        expect(carriers, `no carrier at ${minute}'`).toBe(1);
      }
    }
  });

  it("moves the man on the ball with the ball", () => {
    const match = fixedResult({ home: [], away: [] });

    let moving = 0;

    for (let minute = 1; minute < 80; minute += 0.25) {
      const now = samplePitch({ result: match, minute, seed: 42 });
      const next = samplePitch({ result: match, minute: minute + 0.25, seed: 42 });
      if (now.phase !== "carry" && next.phase !== "carry") continue;

      // A dribble has to actually travel, on the ball or on the man. A carry
      // that leaves both where they were is a player standing still holding it.
      const ballMoved = Math.hypot(next.ball.x - now.ball.x, next.ball.y - now.ball.y);
      const carrierNow = now.players.find((p) => p.hasBall);
      const carrierNext = next.players.find((p) => p.hasBall);
      const manMoved =
        carrierNow && carrierNext
          ? Math.hypot(carrierNext.x - carrierNow.x, carrierNext.y - carrierNow.y)
          : 0;

      if (Math.max(ballMoved, manMoved) > 0.004) moving++;
    }

    expect(moving).toBeGreaterThan(6);
  });
});
