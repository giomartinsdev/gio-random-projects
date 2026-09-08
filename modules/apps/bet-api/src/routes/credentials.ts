import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { BetEnv } from "../lib/accessAuth.js";
import type { CredentialCrypto } from "../lib/crypto.js";
import type { Db } from "../db/index.js";
import { betCredentials } from "../db/schema.js";
import { ensureUser } from "../lib/users.js";
import { VENDORS } from "../lib/vendors.js";

// Where the bookmaker login lives. Only two fields per house
// (username + password — no 2FA on the user's accounts), the password
// never leaves this API except through the runner's /internal claim,
// and it's AES-256-GCM encrypted at rest (lib/crypto.ts).
export function createCredentialsRouter(db: Db, crypto: CredentialCrypto) {
  const app = new Hono<BetEnv>();

  // Never returns passwords — just which houses have saved credentials
  // and what username is on file.
  app.get("/", async (c) => {
    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    const rows = await db
      .select({
        vendor: betCredentials.vendor,
        username: betCredentials.username,
        updatedAt: betCredentials.updatedAt,
      })
      .from(betCredentials)
      .where(eq(betCredentials.userId, user.id));
    return c.json({ credentials: rows });
  });

  app.put("/:vendor", async (c) => {
    const vendor = c.req.param("vendor");
    if (!VENDORS.some((v) => v.id === vendor)) {
      return c.json({ error: `unknown vendor: ${vendor}` }, 400);
    }

    const body = await c.req
      .json<{ username?: unknown; password?: unknown }>()
      .catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) {
      return c.json({ error: "username and password are required" }, 400);
    }

    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    await db
      .insert(betCredentials)
      .values({
        userId: user.id,
        vendor,
        username,
        passwordEncrypted: crypto.encrypt(password),
      })
      .onConflictDoUpdate({
        target: [betCredentials.userId, betCredentials.vendor],
        set: {
          username,
          passwordEncrypted: crypto.encrypt(password),
          updatedAt: new Date(),
        },
      });

    return c.json({ vendor, username, saved: true });
  });

  app.delete("/:vendor", async (c) => {
    const vendor = c.req.param("vendor");
    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    await db
      .delete(betCredentials)
      .where(and(eq(betCredentials.userId, user.id), eq(betCredentials.vendor, vendor)));
    return c.json({ deleted: true });
  });

  return app;
}

export type CredentialsRouter = ReturnType<typeof createCredentialsRouter>;