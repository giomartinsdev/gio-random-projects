// Identity = Cloudflare Access. bet-api's /api path sits
// behind a single Access application (Google SSO, allowed_emails — see the
// cloudflare module), and the edge stamps every request it passes
// through with the Cf-Access-Jwt-Assertion header, a JWT signed with
// the team's public keys. This middleware verifies it properly —
// signature against the team JWKS, issuer against the team domain,
// audience against this app's `aud` set — because the same nginx also
// routes direct (non-edge) traffic here; anyone bypassing Cloudflare
// still needs a valid JWT.
//
// The email claim becomes the bet system's user id (bet_users.email),
// which is exactly what makes the session "shared with the hub": same
// Access session, same email, no second login anywhere.
//
// BET_DEV_AUTH_EMAIL (devEmail) is an explicit local-dev/test escape
// hatch: when set and no JWT header is present, requests run as that
// email. It must stay unset in prod (see index.ts).
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Next } from "hono";

export type AccessUser = { email: string };

export type BetEnv = {
  Variables: {
    user: AccessUser;
  };
};

export type AccessAuth = ReturnType<typeof createAccessAuth>;

export function createAccessAuth(opts: {
  teamDomain: string;
  // One aud per Access application in front of this API. bet-api sits
  // behind a single path app (/api — the login hop lives under it, at
  // /api/sso, because a second app's cookie would carry the other
  // app's aud and be rejected here) — jose accepts a list or a
  // single string either way.
  aud: string | string[];
  // The emails terraform's Access policy allows — defense in depth
  // behind Access's own decision, checked again here.
  allowedEmails?: string[];
  devEmail?: string | null;
}) {
  const jwks = createRemoteJWKSet(new URL(`https://${opts.teamDomain}/cdn-cgi/access/certs`));

  return async function requireAccess(c: Context<BetEnv>, next: () => Promise<void>) {
    const token = c.req.header("cf-access-jwt-assertion");

    if (!token) {
      if (opts.devEmail) {
        c.set("user", { email: opts.devEmail });
        await next();
        return;
      }
      return c.json({ error: "not authenticated" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: `https://${opts.teamDomain}`,
        audience: opts.aud,
      }));
    } catch {
      return c.json({ error: "invalid access token" }, 401);
    }

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return c.json({ error: "access token has no email claim" }, 401);
    if (opts.allowedEmails && !opts.allowedEmails.includes(email)) {
      return c.json({ error: "email not allowed" }, 401);
    }

    c.set("user", { email });
    await next();
  };
}