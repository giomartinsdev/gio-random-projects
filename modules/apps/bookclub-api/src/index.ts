import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDb } from "./db/index.js";

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const port = Number(process.env.PORT ?? 8000);
const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");

const { db } = createDb(databaseUrl);
// Same secret as post-api's own -- see lib/auth.ts's comment on why
// (this instance only validates sessions post-api created, it never
// mints its own).
const auth = createAuth(databaseUrl, authSecret, process.env.BETTER_AUTH_URL ?? "", frontendOrigins);
const { app, injectWebSocket } = createApp(auth, db, frontendOrigins);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bookclub-api listening on :${info.port}`);
});
injectWebSocket(server);
