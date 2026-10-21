import { Rng } from "./rng";
import type { MatchResult } from "./types";

/**
 * The 2D pitch model.
 *
 * Why this is a model and not a renderer: the pitch is the one screen where a
 * player can catch the engine lying. If the ball teleports, if a striker stands
 * still for forty minutes, if the scoreboard says 2-1 while the scoreline says
 * 1-2, the whole simulation loses authority. So positions are computed from the
 * match result and a seeded stream, in normalised pitch coordinates (0..1), with
 * no DOM, no React and no pixels. A test can assert on it; the renderer only
 * draws what this returns.
 *
 * The ball is the centre of this file. It is not a floating decoration: it is
 * held by a named player, released into a pass, struck at goal, and — when the
 * scoreline says a goal happened — it is inside the net at that minute. The
 * whole match is a script of *beats* (carry, pass, shot, restart), built once
 * from the result; every frame is that script interpolated.
 *
 * Order matters. The script owns two explicit points per beat (`from`, `to`),
 * both derived from formation anchors. The ball is that script interpolated,
 * with no reference to the rendered players. The players are then placed around
 * the ball. Doing it the other way round — players first, ball at their feet —
 * is circular, and circular is what produces the one-frame teleport that makes
 * a 2D match look like a diagram.
 */

export const TOTAL_MINUTES = 90;

/** Pitch coordinates are normalised: x runs goal to goal, y across the width. */
export interface PitchPoint {
  x: number;
  y: number;
}

export interface PitchPlayer extends PitchPoint {
  id: string;
  side: "home" | "away";
  /** Shirt number, 1–11. */
  number: number;
  /** True for the man on the ball. */
  hasBall: boolean;
}

export type BallPhase =
  | "kick-off"
  | "carry"
  | "pass"
  | "shot"
  | "goal"
  | "restart";

export interface PitchFrame {
  minute: number;
  players: PitchPlayer[];
  ball: PitchPoint;
  /** Height above the grass, 0 (rolled along the floor) to 1 (high ball). */
  lift: number;
  /** What the ball is doing right now. */
  phase: BallPhase;
  /** True while the ball is in the net after a goal. */
  celebration: boolean;
  /**
   * True when the ball was placed here rather than played here — a restart, a
   * kick-off, or a shot cut in behind a goal with no room for a build-up. The
   * renderer snaps instead of gliding across these.
   */
  dead: boolean;
  /** Which way the possession is leaning right now, -1 (away) to 1 (home). */
  momentum: number;
  /** The side with the ball, for the carrier ring and the commentary tint. */
  possession: "home" | "away";
}

type Side = "home" | "away";

interface FormationSlot {
  number: number;
  /** Rest position, in the team's own half-to-attacking-half frame. */
  x: number;
  y: number;
}

/**
 * A 4-2-3-1, expressed in the attacking direction. `x` is how far up the pitch
 * the player stands (0 = own goal line, 1 = opposition goal line), `y` is across.
 */
const SHAPE: FormationSlot[] = [
  { number: 1, x: 0.045, y: 0.5 },
  { number: 2, x: 0.24, y: 0.16 },
  { number: 5, x: 0.19, y: 0.38 },
  { number: 6, x: 0.19, y: 0.62 },
  { number: 3, x: 0.24, y: 0.84 },
  { number: 4, x: 0.35, y: 0.42 },
  { number: 8, x: 0.35, y: 0.58 },
  { number: 7, x: 0.55, y: 0.15 },
  { number: 10, x: 0.52, y: 0.5 },
  { number: 11, x: 0.55, y: 0.85 },
  { number: 9, x: 0.68, y: 0.46 },
];

/**
 * The lines of the shape, deepest first. A pass moves the ball from one line to
 * another, which is what makes territory emerge from play instead of a sine wave.
 */
const LINES: readonly (readonly number[])[] = [
  [1, 2, 5, 6, 3],
  [4, 8],
  [7, 11, 10],
  [9],
];

const CENTRE: PitchPoint = { x: 0.5, y: 0.5 };

/** Keep tokens off the touchline even when the model drifts. */
const MARGIN_X = 0.03;
const MARGIN_Y = 0.05;

/** The whole shape is pushed this far up its own attacking direction. */
const ADVANCE = 0.08;

/** A ball at a player's feet leads them slightly, and sits a touch in front. */
const BALL_LEAD_X = 0.013;
const BALL_LEAD_Y = 0.012;

/** Deep enough inside the goal that the ball reads as over the line, under the bar. */
const NET_X = 0.03;

/**
 * The goal line, as a fraction of the pitch. It matches the 4.5% inset the
 * renderer draws the touchlines at, so the model and the picture agree about
 * where "over the line" is. Exported because a test asserting the ball is *not*
 * yet a goal should compare against the line, not against a guess at 0.94.
 */
export const GOAL_LINE = 0.045;
/** Posts at 0.445 and 0.555 — the same 11% the markings draw. */
const MOUTH_MIN = 0.455;
const MOUTH_MAX = 0.545;

/** How long the ball stays in the net, in match minutes. */
const GOAL_HOLD = 2.0;

/**
 * How far *before* the scorer's minute the ball actually crosses the line.
 *
 * This has to be small. It exists only so the crossing is not decided by exact
 * floating-point equality on the sampled minute — the scoreboard ticks at 56, so
 * the ball crosses a hair before 56, not a quarter of a minute before. A larger
 * lead puts the ball in the net while the score still reads 1-0, which is the
 * picture contradicting the scoreboard in the other direction.
 */
const CROSS_LEAD = 0.06;

/**
 * How long the ball takes to travel from the goal line to the back of the net,
 * in match minutes.
 *
 * This is deliberately a fixed slice of time rather than a fraction of the hold.
 * The crossing happens `CROSS_LEAD` before the scorer's minute, and the ball has
 * to be visibly *in* the net on that minute, whether the celebration lasts a
 * third of a minute or two. Scaling the settle to the hold would leave the ball
 * sitting on the line for the whole celebration after a goal with room after it.
 */
const NET_SETTLE = 0.08;

/**
 * The minutes a final pass to the striker needs. Below this there is no room to
 * draw the move, so the ball is placed at his feet instead — a cut, not a glide.
 */
const FINAL_PASS = 0.55;

/** Time between the ball hitting the net and the centre-spot restart. */
const RESTART_SPAN = 2.6;
const KICKOFF_SPAN = 1.2;

/**
 * How long the ball is in flight between the striker's boot and the net, in
 * match minutes. Short enough that the shot reads as a strike — at 1× a match
 * minute is about a seventh of a second, so this is roughly a fifth of a second
 * of real time — and long enough to draw three or four frames of travel.
 */
const SHOT_TRAVEL = 1.4;

/**
 * The shortest a shot may be in flight. When two goals fall in consecutive
 * minutes the build-up is squeezed to almost nothing, but the ball must still
 * cross the line *after* it is struck, never before.
 */
const MIN_TRAVEL = 0.45;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const other = (side: Side): Side => (side === "home" ? "away" : "home");

const slotOf = (number: number) =>
  SHAPE.find((s) => s.number === number) ?? SHAPE[0];

interface Beat {
  start: number;
  end: number;
  kind: "kickoff" | "carry" | "pass" | "shot" | "restart";
  /** The side playing the ball. */
  side: Side;
  /** Shirt number of the man with the ball at the start. */
  carrier: number;
  /** Where the ball is at `start`. */
  from: PitchPoint;
  /** Where the ball is at `end` (a shot's `to` is the net, not a boot). */
  to: PitchPoint;
  receiver?: number;
  receiverSide?: Side;
  /** Fraction of the beat at which a shot crosses the line. */
  reach?: number;
  isGoal?: boolean;
  /**
   * True when the ball was *placed* here rather than played here: a restart, or
   * a shot squeezed in behind a goal that left no room for a build-up. The
   * renderer snaps instead of gliding across these, and the continuity tests
   * skip them, because a dead ball really is picked up and moved.
   */
  dead?: boolean;
}

interface Goal {
  minute: number;
  side: Side;
}

interface PlayState {
  side: Side;
  line: number;
  carrier: number;
}

/**
 * The man who takes a dead ball: whoever of that side is closest to the centre
 * spot at that minute. Restarts are taken by midfielders in real football, and
 * picking by shirt number put a full-back on the ball with the whole side
 * trailing behind him.
 */
function nearestToCentre(side: Side, minute: number, seed: number): number {
  let best = SHAPE[0].number;
  let bestD = Number.POSITIVE_INFINITY;

  for (const slot of SHAPE) {
    const p = touchOf(side, slot.number, minute, seed);
    const d = Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y);
    if (d < bestD) {
      bestD = d;
      best = slot.number;
    }
  }

  return best;
}

const pickLine = (rng: Rng, line: number): number => {
  const pool = LINES[clamp(line, 0, LINES.length - 1)];
  return pool[Math.floor(rng.next() * pool.length)];
};

/** The shortest pass worth drawing, in pitch units. */
const MIN_PASS = 0.16;

/**
 * How fast the ball travels, in pitch widths per match minute. This is what turns
 * a distance into a duration, so that every pass on the pitch moves at the same
 * readable speed instead of a short ball and a long ball each getting a fixed
 * slot. At the renderer's half-minute tick the ball moves about 7% of the pitch
 * per frame — fast enough to read as a pass, slow enough to follow with the eye.
 */
const PASS_SPEED = 0.14;

/**
 * How long a pass takes, in match minutes, as a function of how far it travels.
 *
 * The ball moves at roughly one constant speed, which is the whole point: a pass
 * does not take "a beat", it takes as long as the distance needs. A floor keeps a
 * short ball on screen for at least a couple of frames; a ceiling stops one long
 * diagonal from eating a whole build-up. Constant durations are what made every
 * move look equally laboured, and a fixed short duration for a long ball is what
 * makes it flick across the pitch in two frames.
 */
function passDuration(distance: number, remaining: number): number {
  return Math.min(remaining, clamp(distance / PASS_SPEED, 0.55, 3.2));
}

/**
 * Picks a receiver on `line` who is far enough from the ball to make the pass
 * read as a pass.
 *
 * Picking a random shirt on the target line is not enough: on a five-man line
 * one of them is often standing on the passer's toes, and three or four of those
 * in a row is a ball that jiggles in the same square metre for ten minutes. The
 * candidates are ranked by distance from the ball and the far ones are preferred,
 * falling back to the best available when the whole line is close — which is what
 * a short square ball is.
 */
function pickReceiver(
  rng: Rng,
  line: number,
  from: PitchPoint,
  receiverSide: Side,
  minute: number,
  seed: number,
  avoid: number,
): number {
  const dir = receiverSide === "home" ? 1 : -1;

  const measure = (numbers: readonly number[]) =>
    numbers
      .filter((n) => n !== 1 && n !== avoid)
      .map((number) => {
        const to = touchOf(receiverSide, number, minute, seed);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const d = Math.hypot(dx, dy);
        // Reward ground covered and progress up the pitch; punish a ball that
        // goes backwards for no reason. Distance alone picks the man the ball
        // just came from, and A-to-B-to-A for four minutes is a ball vibrating
        // in one square metre.
        const forward = dx * dir;
        return { number, d, score: d + forward * 0.85 };
      })
      .sort((a, b) => b.score - a.score);

  // First the intended line, then the lines either side of it. A carry can drag
  // the ball into the middle of a formation line, and at that point the nearest
  // shirt on the target line is a metre away — a "pass" that barely moves. Moving
  // out a line finds someone who is genuinely open.
  const target = clamp(line, 0, LINES.length - 1);
  const rings = [
    LINES[target],
    ...(LINES[target - 1] ? [LINES[target - 1]] : []),
    ...(LINES[target + 1] ? [LINES[target + 1]] : []),
  ];

  for (const ring of rings) {
    const far = measure(ring).filter((r) => r.d >= MIN_PASS);
    if (far.length) return far[Math.floor(rng.next() * Math.min(far.length, 2))].number;
  }

  // Nothing is open: play the shortest available ball rather than standing still.
  const all = rings.flatMap((ring) => measure(ring)).sort((a, b) => b.d - a.d);
  return all[0]?.number ?? LINES[target][0];
}

/**
 * The man who steps in front of a pass.
 *
 * An interception is not the same pass as a completed one: it has to land at the
 * feet of whoever is *nearest* the ball, because that is what an interception
 * looks like. Aiming it at the far end of a formation line draws a forty-yard
 * pass backwards to a defender, which reads as a mistake in the renderer rather
 * than as a tackle.
 */
function interceptor(
  from: PitchPoint,
  receiverSide: Side,
  minute: number,
  seed: number,
): { number: number; line: number } {
  let best = { number: 4, line: 1, d: Infinity };

  for (let line = 0; line < LINES.length; line++) {
    for (const number of LINES[line]) {
      if (number === 1) continue;
      const to = touchOf(receiverSide, number, minute, seed);
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      if (d < best.d) best = { number, line, d };
    }
  }

  return { number: best.number, line: best.line };
}

/**
 * Per-player drift parameters.
 *
 * Cached because they only depend on (seed, side, shirt), and `samplePitch` is
 * called once per player per frame. Without the cache the pitch allocates a few
 * thousand `Rng`s a second and the match screen starts to stutter.
 */
interface Drift {
  phase: number;
  speedX: number;
  speedY: number;
}

const DRIFT_CACHE = new Map<string, Drift>();

function driftOf(seed: number, side: Side, number: number): Drift {
  const key = `${seed}|${side}|${number}`;
  const hit = DRIFT_CACHE.get(key);
  if (hit) return hit;

  const rng = new Rng(seed, (side === "home" ? 101 : 211) + number * 13);
  const drift: Drift = {
    phase: rng.next() * Math.PI * 2,
    speedX: 0.6 + rng.next() * 0.7,
    speedY: 0.5 + rng.next() * 0.6,
  };

  if (DRIFT_CACHE.size > 512) DRIFT_CACHE.clear();
  DRIFT_CACHE.set(key, drift);
  return drift;
}

/**
 * Where a player stands when the ball is nowhere near them.
 *
 * Pure in (side, number, minute): no ball, no beat, no possession. That purity
 * is the whole trick — every animated position in this file is built on top of
 * it, so continuity of the ball gives continuity of everyone.
 */
function anchorOf(
  side: Side,
  number: number,
  minute: number,
  seed: number,
): PitchPoint {
  const slot = slotOf(number);
  const drift = driftOf(seed, side, number);

  const bobX = Math.sin(minute * 0.09 * drift.speedX + drift.phase) * 0.018;
  const bobY = Math.cos(minute * 0.07 * drift.speedY + drift.phase * 1.7) * 0.022;

  const up = clamp(slot.x + ADVANCE, 0.05, 0.93);
  const x = side === "home" ? up : 1 - up;
  const y = side === "home" ? slot.y : 1 - slot.y;

  return {
    x: clamp(x + bobX, MARGIN_X, 1 - MARGIN_X),
    y: clamp(y + bobY, MARGIN_Y, 1 - MARGIN_Y),
  };
}

/** The ball is at the feet of a player, a shirt-width in front of them. */
function touchOf(
  side: Side,
  number: number,
  minute: number,
  seed: number,
): PitchPoint {
  const anchor = anchorOf(side, number, minute, seed);
  const dir = side === "home" ? 1 : -1;
  return {
    x: clamp(anchor.x + dir * BALL_LEAD_X, MARGIN_X, 1 - MARGIN_X),
    y: clamp(anchor.y + BALL_LEAD_Y, MARGIN_Y, 1 - MARGIN_Y),
  };
}

function goalTarget(side: Side, rng: Rng): PitchPoint {
  const spread = MOUTH_MAX - MOUTH_MIN;
  return {
    x: side === "home" ? 1 - NET_X : NET_X,
    y: MOUTH_MIN + spread * (0.15 + rng.next() * 0.7),
  };
}

/**
 * Builds the whole match as a list of beats.
 *
 * Invariants, both tested:
 *  - beats are contiguous and ordered: `beats[i].end === beats[i + 1].start`;
 *  - every beat's `from` is the previous beat's `to`, except for a dead ball,
 *    where the ball really is picked up and placed somewhere else.
 *
 * Goals are the skeleton. Each one reserves a fixed slot — build-up, shot, ball
 * in the net, restart — and open play fills the gaps without ever crossing into
 * a slot. That is what guarantees the ball is in the net on the scorer's minute
 * and nowhere else.
 */
function buildScript(result: MatchResult, seed: number): Beat[] {
  const rng = new Rng(seed, 977);
  const goals: Goal[] = [
    ...result.scorers.home.map((s) => ({ minute: s.minute, side: "home" as Side })),
    ...result.scorers.away.map((s) => ({ minute: s.minute, side: "away" as Side })),
  ].sort((a, b) => a.minute - b.minute || (a.side === "home" ? -1 : 1));

  // Two goals in the same minute cannot both be animated, so the script gives
  // them a minute each. It is a rare coincidence (three goals in ninety minutes
  // collide about once in thirty matches) and a minute of drift is invisible
  // next to two balls in the same net.
  let lastMinute = -Infinity;
  for (const goal of goals) {
    if (goal.minute <= lastMinute) goal.minute = lastMinute + 1;
    lastMinute = goal.minute;
  }

  const beats: Beat[] = [];
  let state: PlayState = {
    side: rng.chance(0.5) ? "home" : "away",
    line: 1,
    carrier: 0,
  };
  state.carrier = pickLine(rng, state.line);

  const push = (
    kind: Beat["kind"],
    start: number,
    end: number,
    side: Side,
    carrier: number,
    to: PitchPoint,
    extra: Partial<Beat> = {},
  ) => {
    // Continuity by construction: the ball leaves from wherever the last beat
    // left it. Only a dead ball may set `from` explicitly.
    const { from: fromOverride, ...rest } = extra;
    const from =
      fromOverride ??
      beats[beats.length - 1]?.to ??
      touchOf(side, carrier, start, seed);
    beats.push({
      start,
      end,
      kind,
      side,
      carrier,
      from,
      to,
      ...rest,
    });
  };

  // Kick-off: the ball is on the spot, and the taker walks it back to their feet.
  // An early goal shortens it: a first-minute goal has no build-up to wait for.
  const firstGoal = goals[0];
  const kickoffEnd = clamp(
    firstGoal ? firstGoal.minute - CROSS_LEAD - 0.4 : KICKOFF_SPAN,
    0.2,
    KICKOFF_SPAN,
  );

  const kickoffTaker = nearestToCentre(state.side, kickoffEnd, seed);

  beats.push({
    start: 0,
    end: kickoffEnd,
    kind: "kickoff",
    side: state.side,
    carrier: kickoffTaker,
    // The taker is whichever of his side is closest to the centre circle, so the
    // ball rolls a step rather than a third of the pitch. Rolling it out to a
    // full-back standing on the touchline was what made a kick-off look like a
    // training drill.
    from: { ...CENTRE },
    to: touchOf(state.side, kickoffTaker, kickoffEnd, seed),
    dead: true,
  });

  state = { side: state.side, line: 2, carrier: kickoffTaker };
  let t = kickoffEnd;
  // Set when the previous goal left the ball in the net with no time to restart.
  let needsPlacement = false;

  for (let gi = 0; gi < goals.length; gi++) {
    const goal = goals[gi];
    const nextGoal = goals[gi + 1];

    const crossAt = goal.minute - CROSS_LEAD;
    const nextCross = nextGoal ? nextGoal.minute - CROSS_LEAD : TOTAL_MINUTES + 10;

    // The minutes between this ball crossing the line and the next one. They are
    // split — hold, restart, build-up, shot — *in proportion to the gap*, not by
    // fixed spans. Two goals three minutes apart cannot have a full celebration
    // and a full build-up; a goal with ten minutes of room can have both.
    // Assuming a fixed split is what produced a ball that flew from one net to
    // the other.
    const gap = nextCross - crossAt;
    const hold = clamp(gap * 0.15, 0.3, GOAL_HOLD);
    const restartSpan = clamp(gap * 0.15, 0.3, RESTART_SPAN);

    const shotEnd = Math.min(crossAt + hold, TOTAL_MINUTES - 0.4);
    const latestStart = Math.min(crossAt - SHOT_TRAVEL, shotEnd - MIN_TRAVEL);
    const late = t > latestStart + 1e-6;
    const shotStart = late ? t : latestStart;
    const available = shotStart - t;

    // A placed ball is the only honest answer when the script has no minutes
    // left: a goal scored a minute after the last one has no build-up to draw.
    // The ball is put at the striker's feet and the renderer cuts to it, which
    // is what a broadcast does with a quick second goal too.
    const placed = needsPlacement || late || available < FINAL_PASS;

    // How long the last ball to the striker deserves, from how far it has to
    // travel. A ball played from the halfway line needs the minutes; a ball that
    // is already at his feet needs none. Reserving a fixed three-minute beat for
    // a pass of a few centimetres is what made the picture look frozen before a
    // goal — the ball was "passing" without going anywhere.
    const ballNow = beats[beats.length - 1]?.to ?? { ...CENTRE };
    const strikerAt = touchOf(goal.side, 9, shotStart, seed);
    const finalDistance = Math.hypot(strikerAt.x - ballNow.x, strikerAt.y - ballNow.y);
    const finalDur = passDuration(finalDistance, available);
    const wantsFinalPass =
      !placed && finalDistance >= MIN_PASS * 0.75 && available > 0.35;

    const reserve = wantsFinalPass ? Math.min(finalDur, available) : 0;
    const playEnd = Math.max(t, shotStart - reserve);

    state = fillOpenPlay(beats, t, playEnd, rng, seed, state, goal);

    // A last pass to a forward, so the shot comes from the edge of the box
    // rather than from a defender's own half. Doing it for the side that already
    // has the ball too is the point: a goal is a move that ends with a striker,
    // whichever team was passing.
    if (wantsFinalPass && shotStart - playEnd > 0.2) {
      const receiver = 9;
      push(
        "pass",
        playEnd,
        shotStart,
        state.side,
        state.carrier,
        touchOf(goal.side, receiver, shotStart, seed),
        { receiver, receiverSide: goal.side },
      );
      state = { side: goal.side, line: 3, carrier: receiver };
    } else if (state.side !== goal.side) {
      state = { side: goal.side, line: 3, carrier: 9 };
    }

    // The shot. `reach` is where in the beat the ball crosses the line, placed
    // just before the scorer's minute so the net holds it on the minute the
    // scoreboard ticks over.
    const shotFrom = placed ? touchOf(goal.side, 9, shotStart, seed) : undefined;
    push("shot", shotStart, shotEnd, goal.side, state.carrier, goalTarget(goal.side, rng), {
      reach: clamp(
        (crossAt - shotStart) / Math.max(0.001, shotEnd - shotStart),
        0.05,
        0.95,
      ),
      isGoal: true,
      ...(shotFrom ? { from: shotFrom, dead: true } : {}),
    });

    // The restart, taken by the side that conceded.
    const conceding = other(goal.side);
    const restartEnd = Math.min(TOTAL_MINUTES, shotEnd + restartSpan);
    const restartTaker = nearestToCentre(conceding, restartEnd, seed);

    if (restartEnd > shotEnd + 0.25) {
      beats.push({
        start: shotEnd,
        end: restartEnd,
        kind: "restart",
        side: conceding,
        carrier: restartTaker,
        // A restart is the one legitimate discontinuity: the ball is picked out
        // of the net and placed on the spot. The renderer cuts rather than
        // glides for that reason. The taker is again the man nearest the spot.
        from: { ...CENTRE },
        to: touchOf(conceding, restartTaker, restartEnd, seed),
        dead: true,
      });
      t = restartEnd;
      needsPlacement = false;
    } else {
      // No room to restart, so the ball is still in the net when the next goal
      // is built. That goal has to start from a placed ball: a pass out of the
      // net is the one glide this model refuses to draw.
      t = shotEnd;
      needsPlacement = true;
    }

    state = { side: conceding, line: 2, carrier: restartTaker };
  }

  fillOpenPlay(beats, t, TOTAL_MINUTES, rng, seed, state, undefined);

  return beats;
}

/**
 * Fills `[from, to)` with carries and passes, without ever crossing `to`.
 *
 * The last leftover is deliberately a carry: a carry that ends early is a ball
 * at someone's feet, which is harmless, while a *pass* squeezed into half a
 * minute is a ball that crosses the pitch between two frames.
 */
function fillOpenPlay(
  beats: Beat[],
  from: number,
  to: number,
  rng: Rng,
  seed: number,
  start: PlayState,
  goal: Goal | undefined,
): PlayState {
  let t = from;
  let { side, line, carrier } = start;
  // One carry in a row, then a pass. Two carries back to back means the same man
  // dribbles for seven minutes, and a match where nobody passes does not read as
  // football — it reads as a player gliding around with a ball stuck to his boot.
  let justCarried = false;

  const prevTo = () => beats[beats.length - 1]?.to ?? touchOf(side, carrier, t, seed);

  while (to - t >= 0.35) {
    const attacking = goal ? goal.minute - t < 3.4 : false;
    const remaining = to - t;

    if (!attacking && !justCarried && rng.chance(0.34) && remaining >= 1.2) {
      justCarried = true;
      // A carry ends at the carrier's own feet, not at a point invented here.
      // That is the whole reason nobody has to be pinned to the ball: the ball
      // is where he stands because the beat says so, so the token and the ball
      // cannot disagree, and nothing snaps back when possession moves on.
      //
      // It is short on purpose. A carry covers no ground of its own; the ground
      // is covered by passes. A long carry is a man standing still for minutes.
      const dir = side === "home" ? 1 : -1;
      const dur = Math.min(remaining, 0.8 + rng.next() * 1.0);
      const fromPoint = prevTo();
      const next = touchOf(side, carrier, t + dur, seed);

      // The ball sits a boot in front of him rather than under his studs — that
      // is what a dribble looks like from above. Keep it off the touchline too:
      // a player who collects the ball on the line carries it infield.
      const inward = (0.5 - next.y) * 0.06;

      beats.push({
        start: t,
        end: t + dur,
        kind: "carry",
        side,
        carrier,
        from: fromPoint,
        to: {
          x: clamp(next.x + dir * 0.035, 0.14, 0.86),
          y: clamp(next.y + inward, 0.16, 0.84),
        },
      });
      t += dur;
      continue;
    }

    const roll = rng.next();
    // Play mostly goes forward. An even split between forward, square and back
    // lets possession oscillate around the halfway line for ten minutes, which
    // looks like the ball is stuck rather than like a team building.
    let advance = attacking ? 1 : roll < 0.62 ? 1 : roll < 0.88 ? 0 : -1;
    let nextLine = clamp(line + advance, 0, LINES.length - 1);

    // The last line holds one man: the striker. A pass "forward" from him goes to
    // himself, which is not a pass — it is the ball reversing a few metres every
    // four minutes, forever. Turn that into a ball back into midfield instead.
    if (nextLine === line && LINES[nextLine].length === 1) {
      advance = -1;
      nextLine = clamp(line - 1, 0, LINES.length - 1);
    }

    // A share of passes are cut out, which is how possession changes hands
    // inside open play without the ball jumping.
    const receiverSide: Side = rng.chance(0.24) ? other(side) : side;
    const targetLine = nextLine;

    // Duration comes from the ball, not from a fixed beat length. This is the
    // single most important line in this function: with a constant beat, a pass
    // that covers a metre is drawn over the same three minutes as one that
    // covers forty, and the pitch fills up with a ball crawling at walking pace.
    const fromPoint = prevTo();
    let receiver: number;
    if (receiverSide !== side) {
      const steal = interceptor(fromPoint, receiverSide, t, seed);
      receiver = steal.number;
    } else {
      // Pick the receiver who is actually away from the ball. Choosing a shirt at
      // random on the target line lets a pass go to the man standing next to the
      // passer, and a run of those reads as the ball vibrating on the spot for ten
      // minutes rather than as a team moving it.
      receiver = pickReceiver(rng, targetLine, fromPoint, receiverSide, t, seed, carrier);
    }

    const toPoint = touchOf(receiverSide, receiver, t, seed);
    const dist = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
    const dur = passDuration(dist, Number.POSITIVE_INFINITY);

    // A pass is never squeezed to fit the window. Compressing it is exactly what
    // makes a ball flick across the pitch between two frames: the ball has a
    // speed, and if the minutes left cannot hold the pass at that speed, the
    // right answer is the leftover carry at the bottom of this function, not a
    // faster ball.
    if (dur > remaining) break;

    const arrive = t + dur;

    // Re-aim at the receiver's position when the ball gets there, so the pass
    // still lands at his feet rather than where he was standing when it was hit.
    const landing = touchOf(receiverSide, receiver, arrive, seed);

    beats.push({
      start: t,
      end: arrive,
      kind: "pass",
      side,
      carrier,
      receiver,
      receiverSide,
      from: fromPoint,
      to: landing,
    });

    t = arrive;
    side = receiverSide;
    line = receiverSide === side ? nextLine : 1;
    carrier = receiver;
    justCarried = false;
  }

  // Absorb the remainder into a short carry rather than leaving a hole the
  // renderer would show as a frozen ball. The ball barely moves: this is the
  // clock running out on a passage of play, not a dribble.
  if (to - t > 0.05) {
    const dir = side === "home" ? 1 : -1;
    const fromPoint = prevTo();
    beats.push({
      start: t,
      end: to,
      kind: "carry",
      side,
      carrier,
      from: fromPoint,
      to: {
        x: clamp(fromPoint.x + dir * 0.02, 0.14, 0.86),
        y: clamp(fromPoint.y, 0.2, 0.8),
      },
    });
  }

  return { side, line, carrier };
}

const SCRIPT_CACHE = new Map<string, Beat[]>();

function scriptFor(result: MatchResult, seed: number): Beat[] {
  const key = [
    seed,
    result.homeId,
    result.awayId,
    result.scorers.home.map((s) => s.minute).join("."),
    result.scorers.away.map((s) => s.minute).join("."),
  ].join("|");

  const hit = SCRIPT_CACHE.get(key);
  if (hit) return hit;

  const script = buildScript(result, seed);
  if (SCRIPT_CACHE.size > 24) {
    SCRIPT_CACHE.delete(SCRIPT_CACHE.keys().next().value as string);
  }
  SCRIPT_CACHE.set(key, script);
  return script;
}

function beatAt(beats: Beat[], minute: number): Beat {
  let found = beats[0];
  for (const beat of beats) {
    if (beat.start <= minute) found = beat;
    else break;
  }
  return found;
}

/** A pass is stroked around the man in the way, not drilled through him. */
function passPoint(from: PitchPoint, to: PitchPoint, u: number): PitchPoint {
  const bow = 0.12;
  const cx = (from.x + to.x) / 2 + (to.y - from.y) * bow;
  const cy = (from.y + to.y) / 2 - (to.x - from.x) * bow;
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return {
    x: a * from.x + b * cx + c * to.x,
    y: a * from.y + b * cy + c * to.y,
  };
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * The ball at fraction `u` through a beat.
 *
 * This is the only place the ball's position is decided, and it reads nothing
 * but the beat. Two different minutes of the same beat therefore cannot
 * disagree about where the ball "should" have been.
 */
function ballPoint(
  beat: Beat,
  u: number,
): { ball: PitchPoint; lift: number } {
  if (beat.kind === "pass") {
    const dist = Math.hypot(beat.to.x - beat.from.x, beat.to.y - beat.from.y);
    // Long balls are lofted; short ones are rolled.
    const peak = dist > 0.22 ? 0.55 : 0.12;
    return {
      ball: passPoint(beat.from, beat.to, u),
      lift: Math.sin(Math.PI * u) * peak,
    };
  }

  if (beat.kind === "shot") {
    const reach = beat.reach ?? 1;
    const dir = beat.to.x > 0.5 ? 1 : -1;
    // The ball crosses the goal line at `reach`, then settles into the net. Two
    // phases, because "in the net" and "in the goal" are not the same instant:
    // the scoreboard changes when the ball crosses the line, and the net is where
    // it comes to rest afterwards.
    const line: PitchPoint = { x: dir === 1 ? 1 - GOAL_LINE : GOAL_LINE, y: beat.to.y };

    if (u >= reach) {
      // Minutes since the ball crossed the line, converted to a 0..1 settle.
      const span = Math.max(0.001, beat.end - beat.start);
      const since = (u - reach) * span;
      const e = smooth(clamp(since / NET_SETTLE, 0, 1));
      return {
        ball: {
          x: line.x + (beat.to.x - line.x) * e,
          y: line.y + (beat.to.y - line.y) * e,
        },
        lift: 0.08 * (1 - e) + 0.02,
      };
    }

    // A struck ball accelerates on the way to the line.
    const v = Math.pow(clamp(u / Math.max(0.001, reach), 0, 1), 1.35);
    return {
      ball: {
        x: beat.from.x + (line.x - beat.from.x) * v,
        y: beat.from.y + (line.y - beat.from.y) * v,
      },
      lift: Math.sin(Math.PI * v) * 0.42,
    };
  }

  if (beat.kind === "kickoff" || beat.kind === "restart") {
    // The ball sits on the spot while players walk back, then rolls to the
    // taker. Moving it immediately would look like the spot itself was kicked.
    const raw = clamp((u - 0.55) / 0.45, 0, 1);
    const e = smooth(raw);
    return {
      ball: {
        x: beat.from.x + (beat.to.x - beat.from.x) * e,
        y: beat.from.y + (beat.to.y - beat.from.y) * e,
      },
      lift: 0,
    };
  }

  // Carried: the ball rolls with the man, so it follows his breathing too.
  const e = smooth(u);
  return {
    ball: {
      x: beat.from.x + (beat.to.x - beat.from.x) * e,
      y: beat.from.y + (beat.to.y - beat.from.y) * e,
    },
    lift: 0,
  };
}

/**
 * How strongly each role slides toward the ball. Keepers stay home.
 *
 * Low on purpose. A strong pull drags five teammates onto the same square metre
 * whenever the ball sits on a flank, and the separation pass then has to shove
 * them apart in a single frame — a visible hop. Leaning a little is enough to
 * read as a team shifting across.
 */
function followOf(number: number): number {
  if (number === 1) return 0.03;
  const slot = slotOf(number);
  if (slot.x < 0.28) return 0.05;
  return 0.08;
}

/**
 * Places all twenty-two players.
 *
 * The man on the ball is placed *at* the ball, minus the small lead the ball
 * carries: a dribble moves the ball across the grass, so a carrier pinned to a
 * formation slot would be left behind by his own feet. When the ball is in
 * flight nobody is placed on it — the nearest man is marked instead.
 *
 * Everyone else leans toward the ball by role. Because the ball is continuous
 * and the anchors are pure, every token is continuous.
 */
function placePlayers(
  ball: PitchPoint,
  minute: number,
  seed: number,
): PitchPlayer[] {
  const players: PitchPlayer[] = [];

  for (const side of ["home", "away"] as const) {
    for (const slot of SHAPE) {
      const anchor = anchorOf(side, slot.number, minute, seed);
      // Nobody is ever pinned to the ball. Every token is a pure function of its
      // own anchor and the ball, which is what keeps the whole picture continuous:
      // if the ball does not jump, no player can jump either. Pinning the carrier
      // — and unpinning him when possession was re-attributed — was the single
      // cause of the token hops that survived the ball model.
      const follow = followOf(slot.number);
      players.push({
        id: `${side}-${slot.number}`,
        side,
        number: slot.number,
        x: clamp(anchor.x + (ball.x - anchor.x) * follow, MARGIN_X, 1 - MARGIN_X),
        y: clamp(anchor.y + (ball.y - anchor.y) * follow, MARGIN_Y, 1 - MARGIN_Y),
        hasBall: false,
      });
    }
  }

  return players;
}

/**
 * Nudges apart any two tokens that would render on top of each other.
 *
 * Why this exists: the pitch is 956x664, so a token is ~22x26px — much wider in
 * pitch-normalised x than in y. Two players 0.02 apart across the pitch are a
 * clean 19px apart; the same 0.02 vertically is 13px and they collide. A plain
 * radial check therefore passes while the screen shows two shirts stacked. The
 * fix is to separate in *token* space (an ellipse), not in pitch space, and to
 * do it here rather than in the renderer so the tests can see it.
 */
function separate(players: PitchPlayer[]): void {
  const RX = 0.034;
  const RY = 0.058;

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        let dx = (b.x - a.x) / RX;
        let dy = (b.y - a.y) / RY;
        let d = Math.hypot(dx, dy);

        if (d >= 1) continue;

        // Exactly coincident tokens have no direction to separate along; pick
        // one deterministically from their shirt numbers so the result stays
        // reproducible.
        if (d < 1e-6) {
          dx = ((a.number + b.number) % 2 === 0 ? 1 : -1) * 0.5;
          dy = 0.5;
          d = Math.hypot(dx, dy);
        }

        // The man on the ball never moves: the ball is pinned to him, and
        // sliding him out from under it is what makes a carried ball look like
        // it is floating a yard away.
        const pushA = a.hasBall ? 0 : 0.5;
        const pushB = b.hasBall ? 0 : 0.5;
        const push = ((1 - d) / d) * 0.5;
        const total = pushA + pushB || 1;

        a.x = clamp(a.x - (dx * push * RX * pushA) / total, MARGIN_X, 1 - MARGIN_X);
        a.y = clamp(a.y - (dy * push * RY * pushA) / total, MARGIN_Y, 1 - MARGIN_Y);
        b.x = clamp(b.x + (dx * push * RX * pushB) / total, MARGIN_X, 1 - MARGIN_X);
        b.y = clamp(b.y + (dy * push * RY * pushB) / total, MARGIN_Y, 1 - MARGIN_Y);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Samples the pitch at a given minute.
 *
 * `minute` is clamped to [0, 90] rather than wrapped, so a UI that drifts a
 * frame past full time shows the final whistle, not the kick-off again. It also
 * accepts fractions: the renderer ticks half a minute at a time.
 */
export function samplePitch(args: {
  result: MatchResult;
  minute: number;
  seed: number;
}): PitchFrame {
  const minute = clamp(args.minute, 0, TOTAL_MINUTES);
  const { result, seed } = args;

  const beat = beatAt(scriptFor(result, seed), minute);
  const span = Math.max(0.001, beat.end - beat.start);
  const u = clamp((minute - beat.start) / span, 0, 1);

  const { ball, lift } = ballPoint(beat, u);

  // Someone always has the ball unless it is in the net. A shot stays with the
  // man who struck it until the ball crosses the line; a pass belongs to
  // whoever is nearest the moving ball, which is what the eye sees as well.
  const carrierSide: Side = beat.side;
  const carrierNumber =
    beat.kind === "pass"
      ? nearestNumber(ball, carrierSide, minute, seed, beat)
      : beat.carrier;

  // The ball is at his feet only while he is actually carrying it. In flight it
  // belongs to nobody, which is what lets the trail and the shadow do their job.
  const inNet = Boolean(beat.isGoal) && u >= (beat.reach ?? 1);
  const isDead = Boolean(beat.dead) || beat.kind === "kickoff" || beat.kind === "restart";

  const players = placePlayers(ball, minute, seed);

  if (!inNet) {
    const carrier = players.find(
      (p) => p.side === carrierSide && p.number === carrierNumber,
    );
    if (carrier) carrier.hasBall = true;
  }

  separate(players);

  const phase: BallPhase = inNet
    ? "goal"
    : beat.kind === "kickoff"
      ? "kick-off"
      : beat.kind === "restart"
        ? "restart"
        : beat.kind;

  return {
    minute,
    players,
    ball: {
      x: clamp(ball.x, 0.01, 0.99),
      y: clamp(ball.y, 0.03, 0.97),
    },
    lift,
    phase,
    celebration: inNet,
    dead: isDead,
    momentum: clamp((ball.x - 0.5) * 2, -1, 1),
    possession: carrierSide,
  };
}

function nearestNumber(
  ball: PitchPoint,
  side: Side,
  minute: number,
  seed: number,
  beat: Beat,
): number {
  let best = Infinity;
  let number = beat.receiver ?? beat.carrier;

  for (const slot of SHAPE) {
    if (slot.number === 1) continue;
    const anchor = anchorOf(side, slot.number, minute, seed);
    const d = Math.hypot(anchor.x - ball.x, anchor.y - ball.y);
    if (d < best) {
      best = d;
      number = slot.number;
    }
  }

  return number;
}

/**
 * Where the ball *was*, for the motion trail behind it.
 *
 * Sampling backwards matters: a trail that samples forward draws ghosts ahead
 * of the ball, which reads as a prediction rather than a wake. No trail while
 * the ball is at someone's feet — a carried ball does not streak.
 */
export function ballTrail(args: {
  result: MatchResult;
  minute: number;
  seed: number;
}): PitchPoint[] {
  if (args.minute <= 0.6) return [];
  const now = samplePitch(args);
  if (now.phase === "carry" || now.phase === "kick-off" || now.lift <= 0.01) {
    return [];
  }
  return [0.3, 0.6, 0.9].map(
    (step) => samplePitch({ ...args, minute: args.minute - step }).ball,
  );
}
