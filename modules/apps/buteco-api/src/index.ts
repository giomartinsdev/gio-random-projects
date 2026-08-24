import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./lib/auth.js";
import { createDb } from "./db/index.js";

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const port = Number(process.env.PORT ?? 8000);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");

const { db } = createDb(databaseUrl);
const auth = createAuth(db, authSecret, process.env.BETTER_AUTH_URL);
const app = createApp(db, auth);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`buteco-api listening on :${info.port}`);
});
