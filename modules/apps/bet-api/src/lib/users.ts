import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { betUser } from "../db/schema.js";

// Find the Access-identified user or provision it — every public route
// starts here. The .defaultRandom() id + onConflictDoNothing dance is
// the usual "two requests can race the insert" guard.
export async function ensureUser(db: Db, email: string) {
  const existing = await db.query.betUser.findFirst({ where: eq(betUser.email, email) });
  if (existing) return existing;

  const [created] = await db
    .insert(betUser)
    .values({ email })
    .onConflictDoNothing({ target: betUser.email })
    .returning();
  if (created) return created;

  const raced = await db.query.betUser.findFirst({ where: eq(betUser.email, email) });
  if (!raced) throw new Error(`could not provision user for ${email}`);
  return raced;
}

export async function getUserByEmail(db: Db, email: string) {
  return db.query.betUser.findFirst({ where: eq(betUser.email, email) });
}