import type { Club } from "./types";

/** Fixed weekly overhead: admin, travel, groundstaff. Scales gently with capacity. */
export function weeklyOverhead(club: Club): number {
  return 1_500 + Math.round(club.capacity * 0.35);
}

export function weeklyWageBill(club: Club): number {
  return club.players.reduce((sum, player) => sum + player.wage, 0);
}

export function weeklyCosts(club: Club): number {
  return weeklyWageBill(club) + weeklyOverhead(club);
}

/**
 * Commercial income: sponsorship, matchday hospitality, the club shop.
 *
 * A non-league club does not survive on gate receipts alone — sponsorship and
 * league/TV money are what keep the lights on. Without this, every club in the
 * pyramid is structurally insolvent, which is a modelling bug, not difficulty.
 *
 * Scales with division (higher tier = bigger sponsorship pool) and with ground
 * size (more space to sell, more footfall).
 */
export function weeklyCommercial(club: Club): number {
  const tierWeight = Math.max(0.35, 1 - (club.tier - 1) * 0.16);
  const groundFactor = Math.pow(Math.max(0, club.capacity) / 4_000, 0.55);
  const base = 5_400 * tierWeight * groundFactor;

  return Math.max(0, Math.round(base));
}

/**
 * End-of-season prize money.
 *
 * Paid on points rather than league position, so the reward tracks the season a
 * club actually had and not the accidents of the table around it. Scales with
 * division, so promotion brings a bigger cheque as well as bigger costs.
 */
export function prizeMoney(points: number, tier: number): number {
  if (points <= 0) return 0;
  const tierWeight = Math.max(0.3, 1 - (tier - 1) * 0.14);
  return Math.round(points * 650 * tierWeight);
}

/**
 * Attendance model.
 *
 * Three inputs, in descending order of influence:
 *  - fan mood (the board's and the terraces' opinion, 0–100)
 *  - league position (a promotion push fills the ground; a relegation scrap empties it)
 *  - ticket price (elasticity is real in non-league; £18 in the eighth tier is a boycott)
 *
 * Crowds are capped by capacity and floored at a hard core of support, because a
 * club with zero fans on a Tuesday night is a bug, not a story.
 */
export function computeAttendance(
  club: Club,
  position: number,
  totalClubs: number,
): number {
  const moodFactor = 0.42 + (clamp(club.fanMood, 0, 100) / 100) * 0.5;
  const standing = totalClubs <= 1 ? 0.5 : 1 - (position - 1) / (totalClubs - 1);
  const positionFactor = 0.88 + standing * 0.3;

  // £8 is the neutral price; every £1 above it costs ~4% of the crowd.
  const priceFactor = clamp(1 - (club.ticketPrice - 8) * 0.04, 0.45, 1.15);

  const demand = club.capacity * moodFactor * positionFactor * priceFactor;
  const hardCore = Math.min(club.capacity, Math.round(club.capacity * 0.18));

  return Math.min(club.capacity, Math.max(hardCore, Math.round(demand)));
}

export function gateReceipts(attendance: number, ticketPrice: number): number {
  return Math.round(attendance * ticketPrice);
}

/**
 * Morale drifts with results and is pulled back toward the squad's baseline.
 * Winning raises it, losing lowers it, and it decays toward 65 so a bad run does
 * not permanently cripple a club.
 */
export function driftMorale(club: Club, delta: number): Club {
  const players = club.players.map((player) => ({
    ...player,
    morale: Math.round(clamp(player.morale + delta, 15, 100)),
  }));

  return { ...club, players, fanMood: Math.round(clamp(club.fanMood + delta * 0.6, 0, 100)) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
