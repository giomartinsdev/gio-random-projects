// First import, deliberately: the OpenTelemetry hooks must be in place
// before http/pg/fetch are first used. See telemetry.ts's header.
import "./telemetry.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDomainApiClient } from "./lib/domainApiClient.js";
import { logger } from "./logger.js";

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const domainApiUrl = process.env.DOMAIN_API_URL;
const domainApiKey = process.env.DOMAIN_API_KEY;
const port = Number(process.env.PORT ?? 8000);
const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
if (!domainApiUrl) throw new Error("DOMAIN_API_URL is required");
if (!domainApiKey) throw new Error("DOMAIN_API_KEY is required");

// Same secret as post-api's own -- see lib/auth.ts's comment on why
// (this instance only validates sessions post-api created, it never
// mints its own). No local createDb() call: unlike bookclub-api, this
// service owns no Postgres tables of its own -- DATABASE_URL is used
// purely inside createAuth, for reading the shared user/session rows.
const auth = createAuth(databaseUrl, authSecret, process.env.BETTER_AUTH_URL ?? "", frontendOrigins);
const domainApi = createDomainApiClient(domainApiUrl, domainApiKey);

const { app, injectWebSocket } = createApp(auth, domainApi, frontendOrigins);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`classroom-api listening on :${info.port}`);
});
injectWebSocket(server);
