import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AccessAuth, BetEnv } from "./lib/accessAuth.js";
import type { CredentialCrypto } from "./lib/crypto.js";
import type { Db } from "./db/index.js";
import { createAuthRouter } from "./routes/auth.js";
import { createMeRouter } from "./routes/me.js";
import { createCredentialsRouter } from "./routes/credentials.js";
import { createBetsRouter } from "./routes/bets.js";
import { createInternalRouter } from "./routes/internal.js";
import { createRateLimiter } from "./lib/rateLimiter.js";

// Same DI shape post-api uses (this repo's TS convention): a factory
// that takes its collaborators, so tests build the whole app with a
// testcontainers DB, a fake crypto key and a dev email, and prod wires
// the real ones in index.ts.
export function createApp(opts: {
  db: Db;
  frontendOrigins: string[];
  accessAuth: AccessAuth;
  credentialCrypto: CredentialCrypto;
  runnerApiKey: string;
}) {
  const app = new Hono<BetEnv>();

  // credentials: true — the Access session cookie the edge set rides
  // along on cross-origin fetches from bet-frontend; without it the
  // browser drops it and every call goes out unauthenticated.
  app.use(
    "*",
    cors({
      origin: opts.frontendOrigins,
      credentials: true,
      allowHeaders: ["content-type", "x-runner-key"],
    }),
  );

  app.use("*", secureHeaders());

  app.use("/api/*", createRateLimiter({ requestsPerMinute: 60, burst: 60 }));
  // /internal/* is the runner's own loop — unthrottled here, its auth
  // is the shared RUNNER_API_KEY. Mounted at the path (not merged at
  // "/"): the router's use("*") guard would otherwise become a GLOBAL
  // middleware in this app and demand x-runner-key from every
  // /api/* request too.
  app.route("/internal", createInternalRouter(opts.db, opts.credentialCrypto, opts.runnerApiKey));

  // Everything under /api/* (sso hop included) is Access-gated.
  app.use("/api/*", opts.accessAuth);

  app.route("/api", createAuthRouter(opts.frontendOrigins));
  app.route("/api", createMeRouter(opts.db));
  app.route("/api/credentials", createCredentialsRouter(opts.db, opts.credentialCrypto));
  app.route("/api/bets", createBetsRouter(opts.db));

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;