import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Db } from "../db/index.js";
import * as schema from "../db/schema.js";

// Email+password today; Discord OAuth slots in later as another
// provider entry here -- nothing else in this file (or the schema)
// needs to change for that, by design. bearer plugin: this is a
// headless API with non-browser consumers in mind (a future Discord
// bot, scripts) -- Authorization: Bearer <token> instead of requiring
// cookie jars everywhere a client talks to it.
export function createAuth(db: Db, secret: string, baseURL?: string, trustedOrigins?: string[]) {
  return betterAuth({
    secret,
    baseURL,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [bearer()],
    // front (a different registrable domain than post-api, not just a
    // subdomain -- e.g. localhost:5173 in dev) makes this a genuinely
    // cross-site request from the browser's point of view. A default
    // SameSite=Lax cookie never gets sent back on that fetch;
    // SameSite=None requires Secure, which is fine since post-api is
    // only ever served over HTTPS in every environment that matters
    // here (including local dev, which points at the real HTTPS
    // post-api rather than running its own local instance).
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
