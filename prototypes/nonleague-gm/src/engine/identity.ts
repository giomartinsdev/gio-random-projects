/**
 * Visual identity: who a player *looks like*, and what a club's badge looks like.
 *
 * A football game is sold on faces. The moment a squad is a list of names in a
 * table, it reads as an admin tool; the moment each name has a face, it reads as
 * a team. This module is the deterministic bridge between the two: a stable
 * appearance for every player id and a stable badge for every club id.
 *
 * Determinism is not decoration. The same player must have the same face on the
 * pitch, in the squad grid and in a goal celebration, and it must survive a
 * reload — so nothing here uses Math.random. It is also what lets the fictional
 * squad look like a squad without shipping a single licensed likeness.
 *
 * When a real dataset is loaded (API-Football), `Player.photoUrl` and
 * `Club.crestUrl` win: this module is the fallback, not the only source.
 */

/** FNV-1a: small, fast, and stable across runs. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type HairStyle = "crop" | "buzz" | "curtains" | "fade" | "afro" | "knot" | "bald";
export type BeardStyle = "none" | "stubble" | "moustache" | "chin" | "full";
export type BrowStyle = "flat" | "arched" | "heavy";

export interface Appearance {
  /** Skin tone, as a hex fill. */
  skin: string;
  /** Shadow side of the face; two steps darker than `skin`. */
  shade: string;
  hair: string;
  hairStyle: HairStyle;
  beard: BeardStyle;
  brow: BrowStyle;
  /** Head width multiplier, 0.92–1.08 — enough to tell two players apart. */
  build: number;
  /** Eye colour. */
  eyes: string;
  /** 0–4. Small, human asymmetries: a scar, a wide jaw, a crooked mouth. */
  quirk: number;
}

const SKIN = ["#f2c9a6", "#e3ae82", "#c98b5d", "#a96a41", "#7f4a2b", "#5c3520"];
const SHADE = ["#d9ab86", "#c9905f", "#a86c42", "#8a5028", "#633317", "#43220f"];
const HAIR = ["#161311", "#2a1c12", "#4a2d17", "#6b4423", "#a8783c", "#d8c49a", "#6d6a63"];
const EYES = ["#3b2a1c", "#4a3b2a", "#2b4a45", "#31445c"];

const HAIR_STYLES: HairStyle[] = [
  "crop",
  "crop",
  "buzz",
  "curtains",
  "fade",
  "afro",
  "knot",
  "bald",
];
const BEARDS: BeardStyle[] = ["none", "none", "none", "stubble", "moustache", "chin", "full"];
const BROWS: BrowStyle[] = ["flat", "arched", "heavy"];

/**
 * Appearance for a player.
 *
 * `age` nudges the look rather than defining it: veterans lose the hairline and
 * keep the beard, which is the cheapest way to make a squad feel like it has a
 * history instead of twenty rookies.
 */
export function appearanceOf(playerId: string, age = 26): Appearance {
  const h = hashString(playerId);
  const pick = <T,>(items: readonly T[], shift: number): T =>
    items[(h >>> shift) % items.length];

  const skinIndex = pick([0, 1, 1, 2, 2, 3, 3, 4, 5], 3);
  const veteran = age >= 33;
  const style = veteran ? pick(["crop", "buzz", "bald", "fade"] as HairStyle[], 7) : pick(HAIR_STYLES, 7);

  return {
    skin: SKIN[skinIndex],
    shade: SHADE[skinIndex],
    hair: pick(HAIR, 11),
    hairStyle: style,
    beard: veteran ? pick(["stubble", "full", "chin"] as BeardStyle[], 13) : pick(BEARDS, 13),
    brow: pick(BROWS, 17),
    build: 0.92 + ((h >>> 19) % 17) / 100,
    eyes: pick(EYES, 23),
    quirk: (h >>> 5) % 4,
  };
}

export type CrestPattern = "band" | "stripes" | "halves" | "chevron" | "hoops";

export interface CrestDesign {
  pattern: CrestPattern;
  /** Trim colour for the band, chevron or hoop. */
  trim: string;
  /** Initials set on the shield. */
  code: string;
  /** A star above the shield for a club with honours. */
  star: boolean;
}

/**
 * Badge for a club.
 *
 * Real crests are artwork, and artwork is licensed. A generated shield is not:
 * it is built from the club's own colours and initials, so twenty fictional
 * clubs get twenty badges that are recognisably *not* each other without
 * pretending to be Manchester United.
 */
export function crestOf(
  clubId: string,
  colors: { primary: string; secondary: string },
  short: string,
): CrestDesign {
  const h = hashString(clubId);
  const patterns: CrestPattern[] = ["band", "stripes", "halves", "chevron", "hoops"];
  return {
    pattern: patterns[(h >>> 3) % patterns.length],
    trim: colors.secondary,
    code: short.slice(0, 3).toUpperCase(),
    star: (h >>> 9) % 5 === 0,
  };
}

/** Shirt number for a squad index, in the shape a real squad wears it. */
export function shirtNumber(index: number): number {
  // Keepers 1/13, then outfield 2–12, 14–21. A squad of 20 therefore never has
  // two players wearing the same number, which is the one rule a viewer checks.
  if (index === 0) return 1;
  if (index === 1) return 13;
  const natural = index + 1;
  return natural >= 13 ? natural + 1 : natural;
}

/**
 * The six numbers on a player card.
 *
 * The match engine only knows one ability value; shipping six fake attributes
 * that disagree with it would be a lie the first time a 62-rated winger outpaced
 * a 78-rated full-back. So the six are a *shape* around ability, weighted by
 * position: a keeper's pace is low because he is a keeper, not because he is
 * slow, and the average of the six stays close to the real number.
 */
export interface Attributes {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
}

export function attributesOf(player: {
  id: string;
  position: "GK" | "DF" | "MF" | "FW";
  ability: number;
}): Attributes {
  const h = hashString(player.id);
  const jitter = (shift: number) => ((h >>> shift) % 9) - 4;
  const b = player.ability;

  const base: Record<typeof player.position, Attributes> = {
    GK: { pace: b - 18, shooting: b - 34, passing: b - 12, dribbling: b - 22, defending: b - 4, physical: b + 2 },
    DF: { pace: b - 3, shooting: b - 24, passing: b - 8, dribbling: b - 12, defending: b + 6, physical: b + 5 },
    MF: { pace: b - 2, shooting: b - 8, passing: b + 5, dribbling: b + 3, defending: b - 7, physical: b - 1 },
    FW: { pace: b + 5, shooting: b + 6, passing: b - 6, dribbling: b + 4, defending: b - 22, physical: b - 3 },
  };

  const shape = base[player.position];
  const clamp = (n: number) => Math.min(99, Math.max(20, Math.round(n)));

  return {
    pace: clamp(shape.pace + jitter(2)),
    shooting: clamp(shape.shooting + jitter(5)),
    passing: clamp(shape.passing + jitter(7)),
    dribbling: clamp(shape.dribbling + jitter(11)),
    defending: clamp(shape.defending + jitter(13)),
    physical: clamp(shape.physical + jitter(17)),
  };
}

/** "9" for a striker, "RW" for a wide forward — the card's position slot. */
export function positionLabel(player: {
  id: string;
  position: "GK" | "DF" | "MF" | "FW";
}): string {
  if (player.position !== "DF" && player.position !== "MF" && player.position !== "FW") {
    return "GK";
  }
  const h = hashString(player.id);
  const options =
    player.position === "DF"
      ? ["CB", "LB", "RB", "CB", "CB"]
      : player.position === "MF"
        ? ["CM", "CDM", "CAM", "RM", "LM"]
        : ["ST", "ST", "LW", "RW", "CF"];
  return options[(h >>> 7) % options.length];
}
