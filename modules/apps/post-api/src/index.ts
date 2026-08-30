// First import, deliberately: the OpenTelemetry hooks must be in place
// before http/pg/fetch are first used. See telemetry.ts's header.
import "./telemetry.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDb } from "./db/index.js";
import { createDomainApiClient } from "./lib/domainApiClient.js";
import { createMediaClient } from "./lib/minioClient.js";
import { createPostAnnouncer } from "./lib/announcer.js";
import { logger } from "./logger.js";

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

// Object storage for post images -- all five envs or none; half a
// config would only produce broken URLs at request time.
const minioEndpoint = process.env.MINIO_ENDPOINT;
const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;
const minioBucket = process.env.MINIO_BUCKET;
const mediaBaseUrl = process.env.MEDIA_BASE_URL;
const media =
  minioEndpoint && minioAccessKey && minioSecretKey && minioBucket && mediaBaseUrl
    ? createMediaClient(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket, mediaBaseUrl)
    : undefined;

const { db } = createDb(databaseUrl);
const auth = createAuth(db, authSecret, process.env.BETTER_AUTH_URL, frontendOrigins, discord);
const domainApi = createDomainApiClient(domainApiUrl, domainApiKey);
const app = createApp(auth, domainApi, frontendOrigins, db, discord, media);

// Opt-in Discord announcing: the webhook URL IS the credential, so its
// presence toggles the poller (see lib/announcer.ts). Started here
// rather than app.ts because it's a background loop, not a route.
const announceWebhookUrl = process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
if (announceWebhookUrl) {
  createPostAnnouncer({ db, domainApi, webhookUrl: announceWebhookUrl, siteUrl: frontendOrigins[0] }).start(
    30 * 60 * 1000,
  );
  logger.info("discord post announcer enabled");
}

// Self-heal once at boot (terraform normally pre-creates the bucket;
// see lib/minioClient.ts). Not awaited -- a slow MinIO must not delay
// startup, and a failure only means the first upload errors out.
void media?.ensureBucket().catch((err) => logger.warn({ err }, "media bucket ensure failed"));

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`post-api listening on :${info.port}`);
});
