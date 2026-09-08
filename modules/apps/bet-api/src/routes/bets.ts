import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import type { BetEnv } from "../lib/accessAuth.js";
import type { Db } from "../db/index.js";
import { betBet, betCredentials, betUser } from "../db/schema.js";
import { ensureUser } from "../lib/users.js";
import { resolveVendorFromUrl, vendorLabel, type VendorId } from "../lib/vendors.js";

// The bets surface: POST a pasted link, GET the history. The vendor
// comes from the LINK's hostname (vendors.ts) — the user never picks a
// house, they just paste a link. Unknown vendor and missing
// credentials both fail at submission, loudly, so nothing ever sits in
// the queue doomed to fail.
const MAX_UNITS = 100;

export function createBetsRouter(db: Db) {
  const app = new Hono<BetEnv>();

  app.post("/", async (c) => {
    const body = await c.req.json<{ url?: unknown; units?: unknown }>().catch(() => null);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const units = body?.units;

    if (!url) return c.json({ error: "url é obrigatório" }, 400);
    const vendor = resolveVendorFromUrl(url);
    if (!vendor) {
      return c.json({ error: `link não reconhecido como casa conhecida (${url})` }, 400);
    }
    if (typeof units !== "number" || !Number.isSafeInteger(units) || units < 1 || units > MAX_UNITS) {
      return c.json({ error: `units deve ser um inteiro entre 1 e ${MAX_UNITS}` }, 400);
    }

    const { email } = c.get("user");
    const user = await ensureUser(db, email);

    const credentials = await db.query.betCredentials.findFirst({
      where: and(eq(betCredentials.userId, user.id), eq(betCredentials.vendor, vendor)),
    });
    if (!credentials) {
      return c.json({ error: `salve suas credenciais da ${vendorLabel(vendor)} nos ajustes antes de apostar` }, 400);
    }

    // Stake snapshot: units × the unit value AS IT IS NOW. Changing the
    // unit value later never rewrites this bet.
    const [bet] = await db
      .insert(betBet)
      .values({
        userId: user.id,
        vendor,
        url,
        units,
        stakeCents: units * user.unitValueCents,
      })
      .returning();

    return c.json(bet, 201);
  });

  app.get("/", async (c) => {
    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    const bets = await db
      .select()
      .from(betBet)
      .where(eq(betBet.userId, user.id))
      .orderBy(desc(betBet.createdAt))
      .limit(50);
    return c.json({ bets });
  });

  app.get("/:id", async (c) => {
    const { email } = c.get("user");
    const user = await ensureUser(db, email);
    const bet = await db.query.betBet.findFirst({
      where: and(eq(betBet.id, c.req.param("id")), eq(betBet.userId, user.id)),
    });
    if (!bet) return c.json({ error: "bet not found" }, 404);
    return c.json(bet);
  });

  return app;
}

export type BetsRouter = ReturnType<typeof createBetsRouter>;