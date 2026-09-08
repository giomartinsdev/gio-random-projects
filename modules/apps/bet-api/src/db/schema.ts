import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The bet system's own tables, prefixed "bet_" because this Postgres is
// shared: post-api's Better Auth tables (singular "user") and
// domain-api's tables already live in the same database, and these
// three names are generic enough to collide otherwise.
//
// Vendor-agnostic by design: vendor is a value here ("betano" today,
// "bet365" etc. later), never a column set — the only Betano-specific
// thing in this database is a string.

// One row per Access-identified human, auto-provisioned on their first
// authenticated request (no signup flow: the Google SSO email IS the
// account). Money is integer cents everywhere — BRL, no floats.
export const betUser = pgTable("bet_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // The "valor da unidade": one unit = this many cents, editable
  // whenever (PUT /api/settings). Stake of a bet = units × this value,
  // snapshotted at creation into bet_bets so later edits never rewrite
  // history.
  unitValueCents: integer("unit_value_cents").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Login credentials for each bookmaker, per user. passwordEncrypted is
// AES-256-GCM (lib/crypto.ts): base64(iv || ciphertext+tag), key from
// BET_CREDENTIALS_KEY. Composite PK so adding bet365 later is a new
// row, not a migration. Never returned by any public route — only the
// /internal claim response carries (decrypted) credentials to the
// runner.
export const betCredentials = pgTable(
  "bet_credentials",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => betUser.id, { onDelete: "cascade" }),
    vendor: text("vendor").notNull(),
    username: text("username").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.vendor] })],
);

// One bet = one pasted link + how many units. status rides
// queued -> running -> succeeded | failed (failed keeps `error`;
// succeeded keeps `receipt` — what the runner saw: steps log, optional
// screenshot as base64 jpeg, optional bet ref/balance the site showed).
export const betBet = pgTable(
  "bet_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => betUser.id, { onDelete: "cascade" }),
    vendor: text("vendor").notNull(),
    url: text("url").notNull(),
    units: integer("units").notNull(),
    stakeCents: integer("stake_cents").notNull(),
    status: text("status").notNull().default("queued"),
    error: text("error"),
    receipt: jsonb("receipt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  // The claim query is always "oldest queued first" (FOR UPDATE SKIP
  // LOCKED); the user_id index serves each user's history list.
  (table) => [index("bet_bets_claim_idx").on(table.status, table.createdAt)],
);