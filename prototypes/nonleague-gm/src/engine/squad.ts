import type { Club, Player, Strength } from "./types";

/** Slots in the starting XI: 4-4-2. */
const SHAPE = {
  GK: 1,
  DF: 4,
  MF: 4,
  FW: 2,
} as const;

/**
 * Picks the XI.
 *
 * The rule is deliberately simple and legible: best available player per
 * position, then fill any shortfall with the best remaining players regardless
 * of position. A prototype that hides selection behind a solver makes it
 * impossible to tell whether the squad or the algorithm was the problem.
 */
export function pickLineup(club: Club): Player[] {
  const pool = [...club.players].sort((a, b) => b.ability - a.ability);
  const lineup: Player[] = [];

  for (const position of ["GK", "DF", "MF", "FW"] as const) {
    const wanted = SHAPE[position];
    const candidates = pool.filter(
      (p) => p.position === position && !lineup.includes(p),
    );
    lineup.push(...candidates.slice(0, wanted));
  }

  if (lineup.length < 11) {
    for (const player of pool) {
      if (lineup.length >= 11) break;
      if (!lineup.includes(player)) lineup.push(player);
    }
  }

  return lineup.slice(0, 11);
}

/**
 * Converts a squad into two numbers the match engine can use.
 *
 * Attack is the mean of the attacking half (MF + FW); defence is the mean of
 * the defensive half (GK + DF). Averaging rather than summing keeps the scale
 * fixed at 1–99 no matter the shape, so a 4-4-2 and a 4-5-1 are comparable.
 */
export function computeStrength(club: Club): Strength {
  const lineup = pickLineup(club);
  if (lineup.length === 0) return { attack: 30, defence: 30 };

  const attackers = lineup.filter((p) => p.position === "MF" || p.position === "FW");
  const defenders = lineup.filter((p) => p.position === "GK" || p.position === "DF");

  const mean = (players: Player[], fallback: Player[]) => {
    const source = players.length > 0 ? players : fallback;
    const total = source.reduce((sum, p) => sum + p.ability, 0);
    return total / source.length;
  };

  // Morale is a real multiplier: an unhappy squad underperforms by up to 8%.
  const morale = clamp(averageMorale(club) / 70, 0.82, 1.08);

  const attack = clamp(mean(attackers, lineup) * morale, 1, 99);
  const defence = clamp(mean(defenders, lineup) * morale, 1, 99);

  return { attack: round(attack), defence: round(defence) };
}

/**
 * The one face a screen leads with.
 *
 * Highest ability in the XI, keeper excluded unless the squad has nobody else —
 * a keeper is rarely the story of a fixture, and the hero card is a story slot.
 */
export function starPlayer(club: Club): Player | undefined {
  const lineup = pickLineup(club);
  const outfield = lineup.filter((p) => p.position !== "GK");
  const pool = outfield.length > 0 ? outfield : lineup;
  return [...pool].sort((a, b) => b.ability - a.ability)[0];
}

/** The `count` best players in the XI, best first. Used for "key men" rails. */
export function keyPlayers(club: Club, count: number): Player[] {
  return [...pickLineup(club)]
    .sort((a, b) => b.ability - a.ability)
    .slice(0, count);
}

export function averageMorale(club: Club): number {
  if (club.players.length === 0) return 60;
  return club.players.reduce((sum, p) => sum + p.morale, 0) / club.players.length;
}

export function averageAge(club: Club): number {
  if (club.players.length === 0) return 26;
  return club.players.reduce((sum, p) => sum + p.age, 0) / club.players.length;
}

export function squadRating(club: Club): number {
  const { attack, defence } = computeStrength(club);
  return round((attack + defence) / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
