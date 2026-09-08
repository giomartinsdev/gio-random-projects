// Chromium lifecycle: one patchright persistent context per
// (vendor, user), opened for the duration of a bet and closed after.
// The profile directory keeps cookies/localStorage on disk, so the
// bookmaker login survives between runs — the expensive login flow is
// the exception, not the rule. Sequential job processing (one bet at a
// time) guarantees the same profile is never open twice.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "patchright";
import type { BrowserContext, Page } from "patchright";
import type { BetOutcome, BookmakerDriver } from "../vendors/types.js";
import type { ClaimedBet } from "./bff.js";
import { logger } from "../logger.js";

export type BrowserOptions = {
  /** Root directory for the persistent profiles (e.g. /data/profiles). */
  profilesDir: string;
  /** HEADED=1 opens a visible browser — local debugging only. */
  headed: boolean;
  /** Hard wall-clock cap for one bet, ms (drivers have their own inner timeouts). */
  betTimeoutMs: number;
};

export type BetJob = ClaimedBet;

const STEALTH_ARGS = [
  // The flag Chromium greps for in navigator.webdriver gating; patchright
  // patches deeper leaks, this silences the obvious one.
  "--disable-blink-features=AutomationControlled",
  // Shared-memory shenanigans kill Chrome inside containers.
  "--disable-dev-shm-usage",
];

export class BrowserPool {
  constructor(private readonly options: BrowserOptions) {}

  private profileDir(vendor: string, userId: string): string {
    return path.join(this.options.profilesDir, vendor, userId);
  }

  /**
   * Runs one bet: fresh persistent context (login state loaded from
   * disk), one page, the driver's whole flow inside a global timeout.
   * Never throws — every failure mode becomes a failed BetOutcome.
   */
  async runBet(
    job: BetJob,
    credentials: { username: string; password: string },
    driver: BookmakerDriver,
    dryRun: boolean,
    log: (line: string) => void,
  ): Promise<BetOutcome> {
    const dir = this.profileDir(job.vendor, job.userId);
    await mkdir(dir, { recursive: true });

    log("abrindo o Chrome (perfil persistente)");
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(dir, {
        headless: !this.options.headed,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        // No fixed viewport: a natural window size is one fewer
        // automation tell than the default 1280x720.
        viewport: null,
        args: STEALTH_ARGS,
      });
      const page = await context.newPage();

      const outcome = await withTimeout(
        driver.placeBet(page, {
          betId: job.id,
          url: job.url,
          stakeCents: job.stakeCents,
          username: credentials.username,
          password: credentials.password,
          dryRun,
          log,
        }),
        this.options.betTimeoutMs,
        `aposta não terminou em ${Math.round(this.options.betTimeoutMs / 1000)}s`,
        page,
        log,
      );
      return outcome;
    } catch (error) {
      // Drivers report their own failures; anything that reaches here is
      // infrastructure the driver didn't anticipate (browser crash,
      // timeout race, profile corruption). Screenshot what we can.
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: message, vendor: job.vendor, betId: job.id }, "unexpected driver/browser failure");
      return {
        status: "failed",
        error: `erro inesperado no runner: ${message}`,
      };
    } finally {
      // Persistent profiles flush their session to disk on close —
      // skipping this would silently log the user out every run.
      await context?.close().catch(() => undefined);
    }
  }
}

/**
 * Race the bet against a wall-clock cap so a hung page can't wedge the
 * poller forever. On timeout, tries to salvage a screenshot of
 * whatever the page looked like for the receipt.
 */
async function withTimeout(
  promise: Promise<BetOutcome>,
  timeoutMs: number,
  message: string,
  page: Page | null,
  log: (line: string) => void,
): Promise<BetOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<BetOutcome>((resolve) => {
    timer = setTimeout(() => {
      log(`tempo esgotado (${message})`);
      resolve({ status: "failed", error: message });
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
    // A bet that lost the race is still executing somewhere — swallow
    // its eventual rejection (its page is being closed right now, so
    // its operations fail loudly and unobserved).
    void promise.catch(() => undefined);
  }
}