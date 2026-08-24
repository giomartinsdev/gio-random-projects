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
export function createAuth(db: Db, secret: string, baseURL?: string) {
  return betterAuth({
    secret,
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
