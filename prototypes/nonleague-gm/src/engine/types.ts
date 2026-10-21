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
