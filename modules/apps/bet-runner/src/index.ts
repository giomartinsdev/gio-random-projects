import "./telemetry.js";
import { logger } from "./logger.js";
import { BffClient, type ClaimedJob, type ResultReport } from "./lib/bff.js";
import { BrowserPool } from "./lib/browser.js";
import { resolveDriver } from "./vendors/index.js";

// ─── Env ──────────────────────────────────────────────────────────────
// Hard validation at boot: a misconfigured runner that "runs" anyway
// would just poll forever without ever placing a bet, which looks
// exactly like a working one from the outside.

const BET_API_URL = requireEnv("BET_API_URL").replace(/\/$/, "");
const RUNNER_API_KEY = requireEnv("RUNNER_API_KEY");
const PROFILES_DIR = process.env.PROFILES_DIR ?? "/data/profiles";
const POLL_INTERVAL_MS = readInt("POLL_INTERVAL_MS", 5_000, 1_000, 300_000);
const BET_TIMEOUT_MS = readInt("BET_TIMEOUT_MS", 180_000, 30_000, 900_000);
// Safe default: without an explicit DRY_RUN=0 the runner walks every
// flow but never clicks the final confirm. Production sets DRY_RUN=0
// on purpose, once, in terraform.
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const HEADED = process.env.HEADED === "1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(`env ${name} é obrigatória`);
    process.exit(1);
  }
  return value;
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    logger.error(`env ${name} deve ser um inteiro entre ${min} e ${max}, recebido "${raw}"`);
    process.exit(1);
  }
  return value;
}

// ─── Wiring ───────────────────────────────────────────────────────────

const bff = new BffClient(BET_API_URL, RUNNER_API_KEY);
const browser = new BrowserPool({
  profilesDir: PROFILES_DIR,
  headed: HEADED,
  betTimeoutMs: BET_TIMEOUT_MS,
});

let stopping = false;

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function shutdown() {
  if (stopping) {
    // Second signal: someone wants out NOW (e.g. mid-bet docker stop).
    logger.warn("segundo sinal — saindo imediatamente");
    process.exit(1);
  }
  stopping = true;
  logger.info("sinal de desligamento recebido — terminando o ciclo atual");
}

async function exit() {
  logger.info("bet-runner encerrado");
  process.exit(0);
}

// ─── Main loop ────────────────────────────────────────────────────────
// Claim → run → report → (short) sleep. One bet at a time, forever.
// Every error path reports a failed outcome back to the BFF — a job
// that reached "running" must never be left running because the runner
// crashed around it.

async function main(): Promise<void> {
  logger.info(
    {
      betApiUrl: BET_API_URL,
      profilesDir: PROFILES_DIR,
      pollIntervalMs: POLL_INTERVAL_MS,
      betTimeoutMs: BET_TIMEOUT_MS,
      dryRun: DRY_RUN,
      headed: HEADED,
    },
    "bet-runner iniciando",
  );

  while (!stopping) {
    let claimed: ClaimedJob | null = null;
    try {
      claimed = await bff.claim();
    } catch (error) {
      // BFF unreachable (restart, deploy, network blip): not fatal —
      // the queue is durable in Postgres, just wait and try again.
      logger.warn({ err: String(error) }, "claim falhou — tentando de novo no próximo ciclo");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!claimed) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await processJob(claimed);
  }

  await exit();
}

async function processJob(job: ClaimedJob): Promise<void> {
  const { bet } = job;
  const log = (line: string) => logger.info({ betId: bet.id, vendor: bet.vendor }, line);
  logger.info(
    { betId: bet.id, vendor: bet.vendor, url: bet.url, stakeCents: bet.stakeCents, dryRun: DRY_RUN },
    "job claimed",
  );

  const driver = resolveDriver(bet.vendor);
  if (!driver) {
    await report(bet.id, {
      status: "failed",
      error: `casa de aposta "${bet.vendor}" não tem driver no runner ainda`,
    });
    return;
  }

  const outcome = await browser.runBet(bet, job.credentials, driver, DRY_RUN, log);

  if (outcome.status === "succeeded") {
    log("aposta finalizada com sucesso");
    await report(bet.id, { status: "succeeded", receipt: outcome.receipt });
  } else {
    log(`aposta falhou: ${outcome.error}`);
    await report(bet.id, { status: "failed", error: outcome.error, receipt: outcome.receipt });
  }
}

/**
 * Result reporting retried a few times: a lost report leaves the bet
 * stuck in "running" on the BFF (it only accepts results from running
 * bets), which is the one state worth extra effort to avoid.
 */
async function report(betId: string, body: ResultReport): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await bff.reportResult(betId, body);
      return;
    } catch (error) {
      logger.warn({ err: String(error), betId, attempt }, "report falhou — repetindo");
      await sleep(attempt * 2_000);
    }
  }
  logger.error({ betId }, "report falhou 5 vezes — bet ficará 'running' no BFF até correção manual");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (stopping) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, ms);
  });
}

main().catch((error) => {
  logger.error({ err: String(error) }, "loop principal morreu inesperadamente");
  process.exit(1);
});