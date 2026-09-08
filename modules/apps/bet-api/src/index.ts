// First import, deliberately: the OpenTelemetry hooks must be in place
// before http/pg/fetch are first used. See telemetry.ts's header.
import "./telemetry.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAccessAuth } from "./lib/accessAuth.js";
import { createCredentialCrypto } from "./lib/crypto.js";
import { createDb } from "./db/index.js";
import { logger } from "./logger.js";

const databaseUrl = process.env.DATABASE_URL;
const teamDomain = process.env.BET_ACCESS_TEAM_DOMAIN;
// Comma-separated: bet-api sits behind a single Access path app (/api,
// login hop included) — terraform passes its aud (see
// lib/accessAuth.ts's aud comment); extra auds would belong to OTHER
// apps whose cookies must NOT authenticate this API.
const accessAud = (process.env.BET_ACCESS_AUD ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
const credentialsKey = process.env.BET_CREDENTIALS_KEY;
const runnerApiKey = process.env.RUNNER_API_KEY;
const port = Number(process.env.PORT ?? 8009);
// Comma-separated origins the frontend is served from — CORS (app.ts)
// and the /api/sso redirect allowlist (routes/auth.ts) both use this.
const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
// Same allowlist the Access policy enforces at the edge, re-checked in
// lib/accessAuth.ts.
const allowedEmails = (process.env.BET_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((o) => o.trim().toLowerCase())
  .filter(Boolean);
// Local-dev/test identity fallback — MUST stay unset in prod (a value
// here turns every unauthenticated request into that user).
const devEmail = process.env.BET_DEV_AUTH_EMAIL || null;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!teamDomain) throw new Error("BET_ACCESS_TEAM_DOMAIN is required");
if (accessAud.length === 0) throw new Error("BET_ACCESS_AUD is required");
if (!credentialsKey) throw new Error("BET_CREDENTIALS_KEY is required");
if (!runnerApiKey) throw new Error("RUNNER_API_KEY is required");

const { db } = createDb(databaseUrl);
const accessAuth = createAccessAuth({ teamDomain, aud: accessAud, allowedEmails, devEmail });
const credentialCrypto = createCredentialCrypto(credentialsKey);
const app = createApp({ db, frontendOrigins, accessAuth, credentialCrypto, runnerApiKey });

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`bet-api listening on :${info.port}`);
});