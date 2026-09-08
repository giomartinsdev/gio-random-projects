import type { Page } from "patchright";

// A bet, as handed to a driver. The credentials arrive DECRYPTED from
// bet-api's /internal claim and exist only inside this call.
export type BetRequest = {
  betId: string;
  url: string;
  stakeCents: number;
  username: string;
  password: string;
  // DRY_RUN: walk the whole flow, never click the final confirm.
  dryRun: boolean;
  // One human-readable line per step — these become the receipt the
  // user sees in the bets history.
  log: (line: string) => void;
};

// What the user sees on a succeeded bet: what happened, what the page
// proved (screenshot), and whatever identifiers the site showed back.
export type BetReceipt = {
  steps: string[];
  screenshotJpeg?: string;
  betRef?: string;
  balanceCents?: number;
  dryRun?: boolean;
};

export type BetOutcome =
  | { status: "succeeded"; receipt: BetReceipt }
  | { status: "failed"; error: string; receipt?: BetReceipt };

// The vendor abstraction of this whole system: one class per house.
// A driver owns ITS OWN flow (login detection, slip handling, stake
// entry, confirmation) — bet-runner knows none of that. Adding a house
// = a new file here + a registry entry in vendors/index.ts; the BFF
// only ever matches the link's hostname (see bet-api's vendors.ts).
export interface BookmakerDriver {
  readonly vendor: string;
  placeBet(page: Page, req: BetRequest): Promise<BetOutcome>;
}

// Error thrown by drivers on a recoverable, user-explainable failure
// (selector never appeared, site said "insufficient funds"). Anything
// else bubbles up as an unexpected error — the runner still screenshots
// and reports it, with the driver's stack attached.
export class BetError extends Error {}