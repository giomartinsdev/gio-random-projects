import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Db } from "../db/index.js";
import * as schema from "../db/schema.js";

// Email+password is the direct sign-up path. Discord serves BOTH the
// front's normal "Entrar com o Discord" web button (standard OAuth
// redirect through Better Auth's /api/auth/callback/discord) AND the
// Discord Activity (front/src/lib/discordActivity.ts), which turns an
// already-Discord-verified user into a Better Auth session using an
// access_token that flow already obtained through a real server-side
// code exchange (post-api's routes/discord.ts). bearer plugin: in the
// Activity that session travels as an Authorization header, not a
// cookie -- see discordAuthToken.ts's own comment for why cookies
// can't cross the discordsays.com proxy Activities load through.
export function createAuth(
  db: Db,
  secret: string,
  baseURL?: string,
  trustedOrigins?: string[],
  discord?: { clientId: string; clientSecret: string },
) {
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
    socialProviders: discord
      ? {
          discord: {
            clientId: discord.clientId,
            clientSecret: discord.clientSecret,
            // Implicit sign-up stays ON (the default) -- a first-time
            // Discord user should get an account created automatically,
            // not bounce off a missing-account error. That's the whole
            // point ("já entre autorizado").
            // The real verification already happened: routes/discord.ts
            // exchanged the Activity's one-time code for this access_token
            // through Discord's actual token endpoint, using our
            // client_secret -- that round-trip IS the proof it's genuine.
            // What follows (getUserInfo calling Discord's /users/@me with
            // it as a Bearer token) is the actual security check: a forged
            // or expired token fails there with a real 401 from Discord,
            // not here. This override only exists because Better Auth's
            // idToken sign-in path requires SOME verifier to be present
            // before it'll even attempt the provider.getUserInfo call --
            // Discord's bundled provider has no JWT/OIDC id_token config
            // to check against (it doesn't request the openid scope), so
            // without this the whole path 404s as ID_TOKEN_NOT_SUPPORTED.
            verifyIdToken: async () => true,
            // Better Auth's provider default is prompt:"none" (silent
            // re-auth), which Discord answers with consent_required for
            // anyone who hasn't authorized the app yet -- i.e. every
            // first-time web login would fail. Standard "Sign in with X"
            // behavior: show the consent screen.
            prompt: "consent",
          },
        }
      : undefined,
    plugins: [bearer()],
    // front (a different registrable domain than post-api, not just a
    // subdomain -- e.g. localhost:5173 in dev) makes this a genuinely
    // cross-site request from the browser's point of view. A default
    // SameSite=Lax cookie never gets sent back on that fetch;
    // SameSite=None requires Secure, which is fine since post-api is
    // only ever served over HTTPS in every environment that matters
    // here (including local dev, which points at the real HTTPS
    // post-api rather than running its own local instance).
    //
    // crossSubDomainCookies broadens the cookie's own Domain attribute
    // from post-api.giomartins.dev (host-only) to .giomartins.dev, so
    // the SAME session also validates against bookclub-api.giomartins.dev
    // -- see that service's lib/auth.ts for the other half of this
    // (same secret, same domain, reading the same session rows).
    // Existing sessions from before this change keep their old
    // host-only cookie until the next login; not a breaking change,
    // just not retroactive.
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
