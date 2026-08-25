import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDb } from "./db/index.js";
import { createDomainApiClient } from "./lib/domainApiClient.js";

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const domainApiUrl = process.env.DOMAIN_API_URL;
const domainApiKey = process.env.DOMAIN_API_KEY;
const port = Number(process.env.PORT ?? 8000);
// Comma-separated list of origins the frontend is served from --
// needed both for CORS (app.ts) and Better Auth's own CSRF check
// (trustedOrigins).
const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
if (!domainApiUrl) throw new Error("DOMAIN_API_URL is required");
if (!domainApiKey) throw new Error("DOMAIN_API_KEY is required");

const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const discord = discordClientId && discordClientSecret ? { clientId: discordClientId, clientSecret: discordClientSecret } : undefined;

const { db } = createDb(databaseUrl);
const auth = createAuth(db, authSecret, process.env.BETTER_AUTH_URL, frontendOrigins, discord);
const domainApi = createDomainApiClient(domainApiUrl, domainApiKey);
const app = createApp(auth, domainApi, frontendOrigins, discord);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`post-api listening on :${info.port}`);
});
