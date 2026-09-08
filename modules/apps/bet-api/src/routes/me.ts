import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { BetEnv } from "../lib/accessAuth.js";
import type { Db } from "../db/index.js";
import { betCredentials, betUser } from "../db/schema.js";
import { ensureUser } from "../lib/users.js";
import { VENDORS } from "../lib/vendors.js";

// The "who am I + settings" surface the SPA polls. Auto-provisions the
// user row on first sight of an Access-verified email — there is no
// separate signup step anywhere in this system.
export function createMeRouter(db: Db) {
  const app = new Hono<BetEnv>();

  app.get("/me", async (c) => {
    const { email } = c.get("user");
    const user = await ensureUser(db, email);

    const credentials = await db
      .select({ vendor: betCredentials.vendor })
      .from(betCredentials)
      .where(eq(betCredentials.userId, user.id));

    return c.json({
      email: user.email,
      unitValueCents: user.unitValueCents,
      credentials: credentials.map((row) => row.vendor),
      // The vendor list the frontend can offer — "betano" today, more
      // as drivers land. Vendor-agnostic shape: this list is data.
      knownVendors: VENDORS.map((v) => ({ id: v.id, label: v.label })),
    });
  });

  // The "valor da unidade" edit. Only the unit VALUE changes here —
  // queued bets keep their snapshot stake (bet_bets.stake_cents was
  // computed at creation), so this is safe to fire at any time.
  app.put("/me/settings", async (c) => {
    const body = await c.req.json<{ unitValueCents?: unknown }>().catch(() => null);
    const value = body?.unitValueCents;
    const cents =
      typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;

    if (cents === null) {
      return c.json({ error: "unitValueCents must be an integer >= 1 (cents)" }, 400);
    }

    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    await db
      .update(betUser)
      .set({ unitValueCents: cents, updatedAt: new Date() })
      .where(eq(betUser.id, user.id));

    return c.json({ unitValueCents: cents });
  });

  return app;
}

export type MeRouter = ReturnType<typeof createMeRouter>;