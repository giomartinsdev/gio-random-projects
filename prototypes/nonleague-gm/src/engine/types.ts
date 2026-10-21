/** Core data model for the Pyramid prototype. */

export type Position = "GK" | "DF" | "MF" | "FW";

export type Mentality = "cautious" | "balanced" | "attacking";

export type MatchResultKind = "home" | "away" | "draw";

/** A result as it reads for one club, not for the fixture. */
export type FormResult = "W" | "D" | "L";

export interface Player {
  id: string;
  name: string;
  position: Position;
  age: number;
  /** 1–99. The only number the match engine reads. */
  ability: number;
  /** £ per week. */
  wage: number;
  /** £ asking price / book value. */
  value: number;
  morale: number;
  /**
   * Portrait from a licensed data provider (API-Football) or from Wikimedia
   * Commons under a free licence. Absent on the fictional dataset, where
   * `appearanceOf()` draws a generated face instead.
   */
  photoUrl?: string;
  /**
   * Attribution for `photoUrl` when the licence requires it — Commons images are
   * CC BY-SA, so the credit has to travel with the player rather than live in a
   * single site-wide notice.
   */
  photoCredit?: string;
  /** Shirt number from the provider; generated squads derive one from index. */
  number?: number;
  /** Nationality, when the provider has it. */
  nationality?: string;
}

export interface Club {
  id: string;
  name: string;
  /** Three-letter code for compact tables. */
  short: string;
  /** 1 = top tier. Higher number = lower division. */
  tier: number;
  colors: { primary: string; secondary: string };
  capacity: number;
  balance: number;
  ticketPrice: number;
  /** 0–100. Drives attendance alongside league position. */
  fanMood: number;
  players: Player[];
  /** Most recent home attendance, for the finances screen. */
  lastAttendance?: number;
  /** Official crest from a licensed provider; generated badge otherwise. */
  crestUrl?: string;
  /** Stadium name, when the provider has it. */
  venue?: string;
}

export interface Strength {
  attack: number;
  defence: number;
}

export interface Scorer {
  playerId: string;
  playerName: string;
  minute: number;
  side: "home" | "away";
}

export interface MatchEvent {
  minute: number;
  kind: "goal" | "kickoff" | "half-time" | "full-time" | "chance" | "card";
  side: "home" | "away" | "neutral";
  text: string;
}

export interface MatchResult {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  result: MatchResultKind;
  scorers: { home: Scorer[]; away: Scorer[] };
  events: MatchEvent[];
  homeStrength: Strength;
  awayStrength: Strength;
}

export interface Fixture {
  id: string;
  homeId: string;
  awayId: string;
  week: number;
  played: boolean;
  result?: MatchResult;
}

export interface TableRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface SeasonOutcome {
  promoted: string[];
  relegated: string[];
  playoffPlaces: string[];
  championId?: string;
}

export interface FreeAgent {
  id: string;
  name: string;
  position: Position;
  age: number;
  ability: number;
  wage: number;
  value: number;
  /** Transfer fee. 0 means a free agent. */
  fee: number;
}

export interface Career {
  version: 1;
  seed: number;
  /**
   * Where the world came from. `fictional` is the generated pyramid; `licensed`
   * means a snapshot from a data provider was loaded and owns the clubs, badges
   * and portraits.
   */
  source?: "fictional" | "licensed";
  /** Attribution string for the data provider, when `source` is licensed. */
  dataProvider?: string;
  /** How many random draws have been consumed. Keeps the stream stable. */
  rngCursor: number;
  week: number;
  season: number;
  totalTiers: number;
  playerClubId: string;
  mentality: Mentality;
  /** Live clubs in the player's division, keyed by id. */
  clubs: Record<string, Club>;
  fixtures: Fixture[];
  results: MatchResult[];
  /** 1 = top of the table, 20 = bottom. Drives crowds and the board. */
  clubPosition: number;
  /** Last 15 results from *this club's* point of view. */
  form: FormResult[];
  seasonComplete: boolean;
  dismissed: boolean;
  /** Total weeks in the current fixture list. */
  totalWeeks: number;
  trophies: { season: number; tier: number; position: number }[];
  history: {
    season: number;
    tier: number;
    position: number;
    outcome: "promoted" | "relegated" | "stayed";
  }[];
}

export interface CommandResult {
  ok: boolean;
  career: Career;
  reason?: string;
}
