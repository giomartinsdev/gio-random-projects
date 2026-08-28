// First import, deliberately: the OpenTelemetry hooks must be in place
// before http/pg/fetch are first used. See telemetry.ts's header.
import "./telemetry.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDb } from "./db/index.js";
import { createDomainApiClient } from "./lib/domainApiClient.js";
import { createMinioClient } from "./lib/minioClient.js";
import { logger } from "./logger.js";

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const domainApiUrl = process.env.DOMAIN_API_URL;
const domainApiKey = process.env.DOMAIN_API_KEY;
const minioEndpoint = process.env.MINIO_ENDPOINT;
const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;
const minioBucket = process.env.MINIO_BUCKET;
const port = Number(process.env.PORT ?? 8000);
const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
if (!domainApiUrl) throw new Error("DOMAIN_API_URL is required");
if (!domainApiKey) throw new Error("DOMAIN_API_KEY is required");
if (!minioEndpoint) throw new Error("MINIO_ENDPOINT is required");
if (!minioAccessKey) throw new Error("MINIO_ACCESS_KEY is required");
if (!minioSecretKey) throw new Error("MINIO_SECRET_KEY is required");
if (!minioBucket) throw new Error("MINIO_BUCKET is required");

const { db } = createDb(databaseUrl);
// Same secret as post-api's own -- see lib/auth.ts's comment on why
// (this instance only validates sessions post-api created, it never
// mints its own).
const auth = createAuth(databaseUrl, authSecret, process.env.BETTER_AUTH_URL ?? "", frontendOrigins);
const domainApi = createDomainApiClient(domainApiUrl, domainApiKey);
const minio = createMinioClient(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket);
await minio.ensureBucket();

const { app, injectWebSocket } = createApp(auth, db, domainApi, minio, frontendOrigins);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`bookclub-api listening on :${info.port}`);
});
injectWebSocket(server);
