import { Rng } from "./rng";
import { tierBaseline } from "./data";
import type { Club, Player, Position } from "./types";

/**
 * Real-world data, via API-Football (v3).
 *
 * Why this is a *snapshot* and not a live call from the browser: an API key in a
 * client bundle is a published key, and every player who opens the page spends
 * your quota. The shape here is therefore:
 *
 *   scripts/fetch-dataset.mjs  →  public/dataset/football.json  →  this adapter
 *
 * The script holds the key (from the environment) and runs once; the game loads a
 * static file, so it stays fast, offline-capable and free in production. Anyone
 * with a licence — or a demo key — can regenerate the file without touching the
 * game.
 *
 * Ratings are the one thing the provider does not sell: API-Football returns
 * squads, ages and shirt numbers, but no 1–99 ability. `abilityFor()` derives one
 * from squad role, age and the division's baseline, and says so in the UI. It is
 * a *shape*, not an official number, and pretending otherwise would make the
 * match engine's output unexplainable.
 */

/**
 * The raw snapshot the fetch scripts write. Only the fields we read are typed.
 *
 * Two providers produce this shape, and they differ in what they can be trusted
 * for:
 *
 *   `api-football`  a licensed feed: squads, shirt numbers and official photos.
 *                   Requires a key, so it is the paid path.
 *   `wikipedia`     open data: real names, numbers, positions and birthdays from
 *                   article text, photographs only when Wikimedia Commons holds
 *                   one under a free licence. No crests, because club badges are
 *                   uploaded to Wikipedia under fair use and cannot be reused.
 *
 * Both end up as the game's own `Club`/`Player`, so no screen has to know which
 * one it is looking at.
 */
export type SnapshotSource = "api-football" | "wikipedia";

export interface Snapshot {
  meta: {
    source: SnapshotSource;
    leagueId: number;
    leagueName: string;
    season: number;
    fetchedAt: string;
    /** Provider attribution, shown in the UI where the data appears. */
    provider: string;
    /** Licence of the underlying text, when the provider is an open one. */
    licence?: string;
    /** Long-form attribution paragraph for the footer. */
    attribution?: string;
  };
  /**
   * API-Football nests under `teams`; the open-data fetcher writes `clubs`.
   * Both are accepted and normalised, so an older snapshot keeps working.
   */
  teams?: SnapshotTeam[];
  clubs?: SnapshotTeam[];
}

interface SnapshotTeam {
  team: {
    id: number | string;
    name: string;
    code?: string | null;
    logo?: string | null;
    founded?: number | null;
  };
  venue?: {
    name?: string | null;
    capacity?: number | null;
    city?: string | null;
  } | null;
  squad: SnapshotPlayer[];
}

interface SnapshotPlayer {
  id: number | string;
  name: string;
  age?: number | null;
  number?: number | null;
  position?: string | null;
  nationality?: string | null;
  photo?: string | null;
  /** Commons attribution for the photograph, rendered in the footer. */
  photoCredit?: string | null;
  photoLicence?: string | null;
}

export interface Dataset {
  clubs: Club[];
  meta: Snapshot["meta"];
}

/**
 * Provider position → the engine's four.
 *
 * Both spellings have to be here. API-Football sends "Goalkeeper"; the open-data
 * fetcher writes the squad template's `GK`/`DF`/`MF`/`FW` straight through. When
 * only the long names were mapped, every open-data player silently fell back to
 * a position derived from squad index — a defender wearing the number 2 in goal.
 */
const POSITION_MAP: Record<string, Position> = {
  Goalkeeper: "GK",
  Defender: "DF",
  Midfielder: "MF",
  Attacker: "FW",
  "Centre-Back": "DF",
  "Left-Back": "DF",
  "Right-Back": "DF",
  "Defensive Midfield": "MF",
  "Central Midfield": "MF",
  "Attacking Midfield": "MF",
  "Left Midfield": "MF",
  "Right Midfield": "MF",
  "Left Winger": "FW",
  "Right Winger": "FW",
  "Centre-Forward": "FW",
  GK: "GK",
  DF: "DF",
  MF: "MF",
  FW: "FW",
};

/**
 * Short code for a club.
 *
 * The provider usually has a three-letter code; when it does not (very common
 * below the EFL) we take the initials of the name, which is what a printed
 * programme does anyway.
 */
export function shortCode(name: string, code?: string | null): string {
  const given = (code ?? "").trim().toUpperCase();
  if (/^[A-Z]{2,4}$/.test(given)) return given.slice(0, 3);

  const words = name
    .replace(/\b(F\.?C\.?|A\.?F\.?C\.?|Club|Football|The)\b/gi, " ")
    .split(/[\s.]+/)
    .filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  if (initials.length >= 3) return initials.slice(0, 3);
  // Two-word names ("Torquay United") are the common case below the EFL, and
  // "TU" reads as a placeholder. Use the first word instead — TOR, DUL, FYL.
  return (words[0] ?? name).slice(0, 3).toUpperCase();
}

/**
 * A stable kit for a club the provider gives no colours for.
 *
 * API-Football returns a crest but not a palette, so the shirt is derived from
 * the club id — same club, same kit, every load. The hue is spread across the
 * wheel but held at pitch-appropriate saturation: a management game is played
 * under floodlights, and neon shirts would make the 2D pitch unreadable.
 */
export function kitFor(clubId: string | number): { primary: string; secondary: string } {
  let h = 2166136261;
  const key = String(clubId);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  // Contrast-checked across all 360 hues: chalk on the shirt clears 4.5:1, and
  // so does ink on the trim. A club cannot be given a kit its own numbers
  // disappear into.
  return {
    primary: `hsl(${hue} 50% 27%)`,
    secondary: `hsl(${(hue + 152) % 360} 68% 68%)`,
  };
}

/**
 * Ability from squad role and age.
 *
 * `rank` is the player's index in the provider's squad list — providers return
 * it roughly by importance, which is the only ordering signal available without
 * a paid ratings feed. The curve gives the best player in the squad the division
 * baseline + 9 and the last man −10, then applies a mild age peak at 26.
 */
export function abilityFor(rank: number, squadSize: number, age: number, baseline: number): number {
  const spread = squadSize <= 1 ? 0 : rank / (squadSize - 1);
  const role = 9 - spread * 19;
  const ageCurve = age <= 21 ? -3 : age <= 24 ? 0 : age <= 29 ? 1 : age <= 32 ? -2 : -6;
  return Math.min(92, Math.max(28, Math.round(baseline + role + ageCurve)));
}

/**
 * Turns a snapshot into the game's own model.
 *
 * Deterministic, pure, and tolerant: a squad missing shirt numbers or positions
 * still produces playable players, because the alternative — a real dataset that
 * half-loads and leaves a club with nine men — is worse than an imperfect one.
 */
export function fromSnapshot(snapshot: Snapshot, totalTiers = 6): Dataset {
  const tier = 5;
  const baseline = tierBaseline(tier, totalTiers);
  const rng = new Rng(snapshot.meta.leagueId * 7919 + snapshot.meta.season);
  const entries = snapshot.clubs ?? snapshot.teams ?? [];

  const clubs: Club[] = entries.map((entry) => {
    const squad = entry.squad.slice(0, 26);
    const players: Player[] = squad.map((raw, index) => {
      const age = raw.age ?? 26;
      const ability = abilityFor(index, squad.length, age, baseline);
      const position = POSITION_MAP[raw.position ?? ""] ?? fallbackPosition(index);

      return {
        id: `af-${raw.id}`,
        name: raw.name,
        position,
        age,
        ability,
        wage: Math.round((ability - 30) * 22 + 180),
        value: Math.round(Math.pow(Math.max(1, ability - 24), 2.1) * 12),
        morale: 65,
        photoUrl: raw.photo ?? undefined,
        photoCredit: raw.photoCredit ?? undefined,
        number: raw.number ?? index + 1,
        nationality: raw.nationality ?? undefined,
      };
    });

    // A squad with no recognised keeper cannot be simulated honestly; the
    // provider occasionally omits positions for youth players.
    if (!players.some((p) => p.position === "GK") && players[0]) {
      players[0] = { ...players[0], position: "GK" };
    }

    return {
      id: `club-af-${entry.team.id}`,
      name: entry.team.name,
      short: shortCode(entry.team.name, entry.team.code),
      tier,
      colors: kitFor(entry.team.id),
      capacity: entry.venue?.capacity ?? rng.int(2_400, 12_000),
      balance: rng.int(60_000, 420_000),
      ticketPrice: rng.int(9, 22),
      fanMood: rng.int(48, 72),
      players,
      crestUrl: entry.team.logo ?? undefined,
      venue: entry.venue?.name ?? undefined,
    } satisfies Club;
  });

  return { clubs, meta: snapshot.meta };
}

function fallbackPosition(index: number): Position {
  // 2 keepers, then defenders, midfielders, forwards — the shape of a real squad
  // list when the provider sends no positions.
  if (index < 2) return "GK";
  if (index < 9) return "DF";
  if (index < 17) return "MF";
  return "FW";
}

/** Validates a parsed file before it reaches the game. */
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Snapshot>;
  if (!candidate.meta) return null;
  if (candidate.meta.source !== "api-football" && candidate.meta.source !== "wikipedia") {
    return null;
  }
  const entries = candidate.clubs ?? candidate.teams;
  if (!Array.isArray(entries) || entries.length < 2) return null;
  if (
    !entries.every(
      (t) =>
        t?.team?.name &&
        Array.isArray(t.squad) &&
        t.squad.length >= 11 &&
        typeof t.team.id !== "undefined",
    )
  ) {
    return null;
  }
  return candidate as Snapshot;
}

/**
 * Loads the snapshot if the deployment has one.
 *
 * Missing file, bad JSON, an offline phone: every one of those resolves to
 * `null` and the game falls back to its generated world. A data source is an
 * enhancement, never a precondition for playing.
 */
export async function loadDataset(url = "/dataset/football.json"): Promise<Dataset | null> {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    // A single-page host answers a missing file with index.html and HTTP 200, so
    // the status says "found" when nothing is there. The type is the real check.
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) return null;
    const snapshot = parseSnapshot(await response.json());
    return snapshot ? fromSnapshot(snapshot) : null;
  } catch {
    return null;
  }
}
