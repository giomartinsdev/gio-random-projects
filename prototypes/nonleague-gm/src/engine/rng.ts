/**
 * Seeded PRNG.
 *
 * Why not Math.random: a career must be reproducible from its save file. If the
 * engine reached for global randomness, reloading a save would silently change
 * the outcome of the next match, and you could never tell whether your tactic
 * mattered or you just got a different dice roll. Every draw goes through this
 * stream, and the career stores how many draws it has consumed.
 */

/** A 32-bit hash, so a seed can be any integer and still spread out. */
function mix(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = h ^ (h >>> 15);
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number, cursor = 0) {
    // Combine seed and cursor with 32-bit integer ops only. Doing this with
    // plain `seed + cursor * 0x9e3779b9` overflows Number.MAX_SAFE_INTEGER for
    // realistic cursor values, silently collapsing every seed onto the same
    // state — which makes the "random" stream identical across careers.
    const combined = (mix(seed >>> 0) ^ mix(cursor >>> 0)) >>> 0;
    this.state = mix(combined);
  }

  /** Uniform in [0, 1). Mulberry32 — small, fast, good enough for a game. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot pick from an empty list");
    return items[Math.floor(this.next() * items.length)];
  }
}

/** Poisson draw via Knuth's method — goals are counts, not coin flips. */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  // For large lambda Knuth is slow; normal approximation is fine for football.
  if (lambda > 30) {
    const normal =
      lambda +
      Math.sqrt(lambda) *
        (rng.next() + rng.next() + rng.next() + rng.next() + rng.next() + rng.next() - 3) *
        Math.SQRT2;
    return Math.max(0, Math.round(normal));
  }

  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count++;
    product *= rng.next();
  } while (product > limit);
  return count - 1;
}
