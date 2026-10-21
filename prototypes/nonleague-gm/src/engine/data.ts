import { Rng } from "./rng";
import type { Club, Player, Position } from "./types";

/**
 * All club and player names are invented. Nothing here is licensed.
 *
 * That is not a legal footnote, it is a design constraint: the moment you use
 * real club names, crests or a real pyramid's exact 320 clubs, you need
 * licences you cannot afford. A fictional world also lets the game own its
 * canon — the clubs that become fan favourites are *yours*.
 */
const CLUB_NAMES = [
  ["Ashcombe Rovers", "ASH"],
  ["Barrowfield United", "BAR"],
  ["Cobbleton Athletic", "COB"],
  ["Dunmere Town", "DUN"],
  ["Eastgate Wanderers", "EAS"],
  ["Fenwick Albion", "FEN"],
  ["Grimsdale County", "GRI"],
  ["Harlow Vale", "HAR"],
  ["Ingleby Sports", "ING"],
  ["Kestrel Park", "KES"],
  ["Larkhall City", "LAR"],
  ["Mossley Bridge", "MOS"],
  ["Northolt Rangers", "NOR"],
  ["Oakhampton FC", "OAK"],
  ["Penhurst Athletic", "PEN"],
  ["Quarrydale United", "QUA"],
  ["Redmarsh Town", "RED"],
  ["Saltcoates FC", "SAL"],
  ["Thornbury Wanderers", "THO"],
  ["Uppermill County", "UPP"],
  ["Vale of Avon", "VOA"],
  ["Westhaven Rovers", "WES"],
  ["Yewfield Athletic", "YEW"],
  ["Zenith Park", "ZEN"],
] as const;

const FIRST_NAMES = [
  "Alfie", "Billy", "Callum", "Danny", "Ellis", "Finn", "George", "Harry",
  "Isaac", "Jack", "Kane", "Liam", "Mason", "Noah", "Ollie", "Reece",
  "Sam", "Tom", "Will", "Zac", "Aiden", "Blake", "Corey", "Dylan",
];

const LAST_NAMES = [
  "Ainsworth", "Bramley", "Carter", "Doherty", "Ellison", "Fletcher",
  "Granger", "Hollis", "Ingram", "Jennings", "Kelsey", "Lockhart",
  "Mercer", "Newby", "Osborne", "Pike", "Quinn", "Radcliffe",
  "Sutcliffe", "Thorne", "Underwood", "Vance", "Whitlock", "Yardley",
];

/** Tier difficulty: lower divisions have lower ability ceilings. */
export function tierBaseline(tier: number, totalTiers: number): number {
  // Tier 1 (top) ~ 78 average, bottom tier ~ 48 average.
  const span = Math.max(1, totalTiers - 1);
  const t = (tier - 1) / span;
  return Math.round(78 - t * 30);
}

export function createSquad(rng: Rng, tier: number, totalTiers: number, clubIndex: number): Player[] {
  const baseline = tierBaseline(tier, totalTiers);
  const players: Player[] = [];

  // 20 players: 2 keepers, 7 defenders, 7 midfielders, 4 forwards.
  const shape: Position[] = [
    "GK", "GK",
    "DF", "DF", "DF", "DF", "DF", "DF", "DF",
    "MF", "MF", "MF", "MF", "MF", "MF", "MF",
    "FW", "FW", "FW", "FW",
  ];

  shape.forEach((position, index) => {
    const spread = rng.int(-9, 9);
    // Clubs within a division differ by up to ~8 points of quality.
    const clubQuality = (clubIndex % 8) - 3.5;
    const ability = clamp(baseline + spread + clubQuality, 25, 92);
    const age = rng.int(18, 35);
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;

    players.push({
      id: `p-${clubIndex}-${index}`,
      name,
      position,
      age,
      ability,
      wage: Math.round((ability - 30) * 22 + 180),
      value: Math.round(Math.pow(Math.max(1, ability - 24), 2.1) * 12),
      morale: 65,
    });
  });

  return players;
}

export function createClubs(
  rng: Rng,
  tier: number,
  totalTiers: number,
  count = 20,
): Club[] {
  const startIndex = rng.int(0, CLUB_NAMES.length - count);

  return Array.from({ length: count }, (_, index) => {
    const [name, short] = CLUB_NAMES[(startIndex + index) % CLUB_NAMES.length];
    const capacity = rng.int(2_200, 9_500);

    return {
      id: `club-${tier}-${index + 1}`,
      name,
      short,
      tier,
      // Lightness and saturation are not taste: they are the values at which
      // chalk on the shirt and ink on the number both clear 4.5:1 for every one
      // of the 360 hues. Brightening the shirt broke the shirt numbers.
      colors: {
        primary: `hsl(${rng.int(0, 359)} 50% 27%)`,
        secondary: `hsl(${rng.int(0, 359)} 68% 68%)`,
      },
      capacity,
      balance: rng.int(40_000, 320_000),
      ticketPrice: rng.int(7, 16),
      fanMood: rng.int(45, 70),
      players: createSquad(rng, tier, totalTiers, index),
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
