import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authSchema from "../db/authSchema.js";

// classroom-api never mounts /api/auth/* (no sign-up/sign-in here --
// that only ever happens through post-api). This betterAuth instance
// exists purely so auth.api.getSession() can validate a session
// cookie or bearer token that was issued BY post-api: same Postgres
// database (so it's reading the exact same session/user rows), same
// secret (session cookies/tokens are signed, not just a raw lookup)
// and same crossSubDomainCookies config (so a cookie post-api set
// with Domain=.giomartins.dev actually gets sent to this host at
// all). Same shape as bookclub-api's own lib/auth.ts -- if post-api's
// secret or cookie domain ever changes, this file needs the matching
// change too.
export function createAuth(connectionString: string, secret: string, baseURL: string, trustedOrigins: string[]) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: authSchema });

  return betterAuth({
    secret,
    baseURL,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [bearer()],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
      crossSubDomainCookies: {
        enabled: true,
        domain: ".giomartins.dev",
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
