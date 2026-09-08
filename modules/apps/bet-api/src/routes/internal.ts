import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import type { CredentialCrypto } from "../lib/crypto.js";
import type { Db } from "../db/index.js";
import { betBet, betCredentials } from "../db/schema.js";
import { logger } from "../logger.js";

// The runner's surface — bet-runner calls this over the docker network
// (never through the edge, so Access isn't involved), authenticated
// with the shared RUNNER_API_KEY (X-Runner-Key header). Two verbs:
//
//   POST /internal/jobs/claim     — atomically take the oldest queued
//                                   bet (FOR UPDATE SKIP LOCKED, so
//                                   even a hypothetical second runner
//                                   can't double-claim) and hand over
//                                   the DECRYPTED credentials for it.
//   POST /internal/jobs/:id/result — the outcome (status/error/receipt).
//
// Bets whose credentials disappeared between enqueue and claim fail
// right here (with a human-readable error) and the claim moves on to
// the next queued row — nothing gets handed out half-configured.
const MAX_STEPS = 200;
const MAX_STEP_LENGTH = 500;
const MAX_SCREENSHOT_CHARS = 1_500_000;
const MAX_ERROR_CHARS = 2_000;
const MAX_CLAIM_ATTEMPTS = 5;

export function createInternalRouter(db: Db, crypto: CredentialCrypto, runnerApiKey: string) {
  const app = new Hono();

  // Guard for every route below — runner auth, not Access auth.
  app.use("*", async (c, next) => {
    if (c.req.header("x-runner-key") !== runnerApiKey) {
      return c.json({ error: "runner authentication failed" }, 401);
    }
    await next();
  });

  app.post("/jobs/claim", async (c) => {
    // A missing-credentials bet gets failed inside the same
    // transaction, then we look at the next queued one — bounded by
    // MAX_CLAIM_ATTEMPTS so a pathological queue can't spin here
    // forever.
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      const claimed = await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(betBet)
          .where(eq(betBet.status, "queued"))
          .orderBy(asc(betBet.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });

        if (!candidate) return null;

        const credentials = await tx.query.betCredentials.findFirst({
          where: and(eq(betCredentials.userId, candidate.userId), eq(betCredentials.vendor, candidate.vendor)),
        });

        if (!credentials) {
          await tx
            .update(betBet)
            .set({
              status: "failed",
              error: `credenciais da ${candidate.vendor} foram removidas antes da execução`,
              finishedAt: new Date(),
            })
            .where(eq(betBet.id, candidate.id));
          return { retriable: true as const };
        }

        const [running] = await tx
          .update(betBet)
          .set({ status: "running", startedAt: new Date() })
          .where(eq(betBet.id, candidate.id))
          .returning();

        return {
          retriable: false as const,
          bet: running,
          credentials: {
            username: credentials.username,
            password: crypto.decrypt(credentials.passwordEncrypted),
          },
        };
      });

      if (!claimed || !claimed.retriable) return c.json(claimed ?? { bet: null });
    }

    logger.warn("claim hit the retry bound without finding a runnable bet");
    return c.json({ bet: null });
  });

  app.post("/jobs/:id/result", async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const parsed = parseResult(body);
    if (!parsed) return c.json({ error: "invalid result payload" }, 400);

    const updated = await db
      .update(betBet)
      .set({
        status: parsed.status,
        error: parsed.status === "failed" ? parsed.error : null,
        // The receipt survives failures too — its screenshot is how a
        // failed run gets debugged (the driver's errors say "veja o
        // screenshot"; discarding it made that a dead reference).
        receipt: parsed.receipt ?? null,
        finishedAt: new Date(),
      })
      // Only a still-running bet accepts a result: a duplicate report
      // after failure/success is a harmless no-op, and a bet that was
      // somehow reset to queued can't be overwritten by a stale runner.
      .where(and(eq(betBet.id, c.req.param("id")), eq(betBet.status, "running")))
      .returning();

    if (updated.length === 0) return c.json({ error: "bet not running" }, 409);
    return c.json({ updated: true });
  });

  return app;
}

export type InternalRouter = ReturnType<typeof createInternalRouter>;

type Receipt = {
  steps?: string[];
  screenshotJpeg?: string;
  betRef?: string;
  balanceCents?: number;
  dryRun?: boolean;
};

function parseResult(body: unknown):
  | { status: "succeeded" | "failed"; error?: string; receipt?: Receipt }
  | null {
  if (!body || typeof body !== "object") return null;
  const { status, error, receipt } = body as {
    status?: unknown;
    error?: unknown;
    receipt?: unknown;
  };

  if (status !== "succeeded" && status !== "failed") return null;

  let cleanError: string | undefined;
  if (typeof error === "string" && error.length > 0) {
    cleanError = error.slice(0, MAX_ERROR_CHARS);
  } else if (status === "failed") {
    return null; // a failure without an error message tells nobody anything
  }

  let cleanReceipt: Receipt | undefined;
  if (typeof receipt === "object" && receipt !== null) {
    const r = receipt as Receipt;
    cleanReceipt = {};
    if (Array.isArray(r.steps)) {
      cleanReceipt.steps = r.steps
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.slice(0, MAX_STEP_LENGTH))
        .slice(0, MAX_STEPS);
    }
    if (typeof r.screenshotJpeg === "string" && r.screenshotJpeg.length <= MAX_SCREENSHOT_CHARS) {
      cleanReceipt.screenshotJpeg = r.screenshotJpeg;
    }
    if (typeof r.betRef === "string") cleanReceipt.betRef = r.betRef.slice(0, 100);
    if (typeof r.balanceCents === "number" && Number.isSafeInteger(r.balanceCents) && r.balanceCents >= 0) {
      cleanReceipt.balanceCents = r.balanceCents;
    }
    if (typeof r.dryRun === "boolean") cleanReceipt.dryRun = r.dryRun;
  }

  return { status, error: cleanError, receipt: cleanReceipt };
}