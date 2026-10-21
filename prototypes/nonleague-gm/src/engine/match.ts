import { poisson, Rng } from "./rng";
import { computeStrength, pickLineup } from "./squad";
import type {
  Club,
  MatchEvent,
  MatchResult,
  Mentality,
  Player,
  Scorer,
  Strength,
} from "./types";

export interface SimulateArgs {
  home: Club;
  away: Club;
  seed: number;
  /** The home manager's pick. */
  mentality?: Mentality;
  /**
   * The away manager's pick. Defaults to the home pick so a single-mentality
   * call still behaves as before — but in a friend league both sides pick, and
   * one manager going attacking must not secretly make the other attacking too.
   */
  awayMentality?: Mentality;
  /** Ties the draw to a fixture, so the same match never replays differently. */
  fixtureId?: string;
}

/** Expected goals for a side, given both strengths and the mentality dial. */
const MENTALITY = {
  cautious: { attack: 0.78, defence: 0.86 },
  balanced: { attack: 1, defence: 1 },
  attacking: { attack: 1.24, defence: 1.16 },
} as const;

/**
 * Simulates one match.
 *
 * The model is intentionally a Poisson goal model rather than a minute-by-minute
 * possession sim. Reasons:
 *  - It is calibrated against real football: ~2.7 goals/game, ~46% home wins.
 *  - Two parameters (expected goals for each side) can be tuned and *tested*
 *    statistically, which the .feature file does.
 *  - It is fast enough to sim a full season in a frame.
 *
 * Everything that follows from the scoreline (scorers, events, result) is
 * derived in one place, so the scoreline can never disagree with the timeline.
 */
export function simulateMatch({
  home,
  away,
  seed,
  mentality = "balanced",
  awayMentality = mentality,
  fixtureId = "",
}: SimulateArgs): MatchResult {
  const rng = new Rng(seed, hash(fixtureId));
  const homeStrength = computeStrength(home);
  const awayStrength = computeStrength(away);

  const dial = MENTALITY[mentality];
  const awayDial = MENTALITY[awayMentality];

  // Home advantage: +6% attack, +4% defence. Empirical, not decorative — the
  // feature file asserts the resulting win rate stays in a plausible band.
  const homeLambda =
    baseExpectedGoals(homeStrength.attack, awayStrength.defence) *
    1.12 *
    dial.attack *
    // The away manager's shape changes how exposed their defence is.
    awayDial.defence;
  // Away side: the 0.94 is standard home-advantage suppression; the extra
  // division by mismatch keeps genuine blowouts from being coin flips.
  const awayLambda =
    (baseExpectedGoals(awayStrength.attack, homeStrength.defence) *
      0.94 *
      awayDial.attack *
      // A cautious home side concedes less; an attacking one leaves gaps.
      (2 - dial.defence)) /
    mismatchPenalty(awayStrength.attack, homeStrength.defence);

  const homeGoals = Math.min(9, poisson(rng, homeLambda));
  const awayGoals = Math.min(9, poisson(rng, awayLambda));

  const homeScorers = pickScorers(rng, home, homeGoals, "home");
  const awayScorers = pickScorers(rng, away, awayGoals, "away");

  const events = buildEvents({
    home,
    away,
    homeGoals,
    awayGoals,
    homeScorers,
    awayScorers,
    homeStrength,
    awayStrength,
    rng,
  });

  return {
    homeId: home.id,
    awayId: away.id,
    homeGoals,
    awayGoals,
    result:
      homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw",
    scorers: { home: homeScorers, away: awayScorers },
    events,
    homeStrength,
    awayStrength,
  };
}

/**
 * Maps attack vs opposing defence to expected goals.
 *
 * Anchored so that an even 60v60 fixture expects ~1.4 goals a side, which lands
 * the league average around 2.7 — the real English pyramid figure.
 */
function baseExpectedGoals(attack: number, opposingDefence: number): number {
  const edge = (attack - opposingDefence) / 100;
  return clamp(1.4 * Math.exp(edge * 2.1), 0.18, 4.6);
}

/**
 * Extra suppression for a side that is outclassed.
 *
 * A plain exponential gives a 30-point gap only ~83% — a cup upset every sixth
 * tie. Real mismatches are more decisive than that, so the weaker attack is
 * damped quadratically once it falls more than ~12 points behind the defence it
 * faces. Symmetric: it only ever reduces the weaker side's output.
 */
function mismatchPenalty(attack: number, opposingDefence: number): number {
  const deficit = opposingDefence - attack;
  if (deficit <= 12) return 1;
  return 1 + Math.pow((deficit - 12) / 18, 2) * 1.1;
}

function pickScorers(
  rng: Rng,
  club: Club,
  goals: number,
  side: "home" | "away",
): Scorer[] {
  const lineup = pickLineup(club);
  // Weight by position: forwards score most, then midfielders, then defenders.
  const weights = lineup.map((player) => ({ player, weight: scoringWeight(player) }));
  const total = weights.reduce((sum, w) => sum + w.weight, 0);

  const scorers: Scorer[] = [];
  for (let i = 0; i < goals; i++) {
    let roll = rng.next() * total;
    let chosen: Player = lineup[lineup.length - 1] ?? club.players[0];
    for (const entry of weights) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry.player;
        break;
      }
    }
    if (!chosen) continue;
    scorers.push({
      playerId: chosen.id,
      playerName: chosen.name,
      minute: rng.int(1, 90),
      side,
    });
  }

  return scorers.sort((a, b) => a.minute - b.minute);
}

function scoringWeight(player: Player): number {
  const base = player.ability / 10;
  switch (player.position) {
    case "FW":
      return base * 4;
    case "MF":
      return base * 1.6;
    case "DF":
      return base * 0.45;
    case "GK":
      return base * 0.02;
  }
}

interface EventArgs {
  home: Club;
  away: Club;
  homeGoals: number;
  awayGoals: number;
  homeScorers: Scorer[];
  awayScorers: Scorer[];
  homeStrength: Strength;
  awayStrength: Strength;
  rng: Rng;
}

function buildEvents(args: EventArgs): MatchEvent[] {
  const { home, away, homeScorers, awayScorers, rng } = args;
  const events: MatchEvent[] = [
    { minute: 0, kind: "kickoff", side: "neutral", text: `Kick-off at ${home.name}.` },
  ];

  const goals = [
    ...homeScorers.map((s) => ({ ...s, side: "home" as const })),
    ...awayScorers.map((s) => ({ ...s, side: "away" as const })),
  ].sort((a, b) => a.minute - b.minute);

  let homeRunning = 0;
  let awayRunning = 0;

  for (const goal of goals) {
    if (goal.side === "home") homeRunning++;
    else awayRunning++;
    events.push({
      minute: goal.minute,
      kind: "goal",
      side: goal.side,
      text: `${goal.playerName} scores for ${goal.side === "home" ? home.name : away.name} — ${homeRunning}–${awayRunning}.`,
    });
  }

  if (rng.chance(0.35)) {
    events.push({
      minute: rng.int(30, 88),
      kind: "chance",
      side: rng.chance(0.5) ? "home" : "away",
      text: "A chance goes begging from a corner.",
    });
  }

  events.push({ minute: 45, kind: "half-time", side: "neutral", text: "Half-time." });
  events.push({
    minute: 90,
    kind: "full-time",
    side: "neutral",
    text: `Full-time: ${home.short} ${args.homeGoals}–${args.awayGoals} ${away.short}.`,
  });

  return events.sort((a, b) => a.minute - b.minute);
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
