import { Hono } from "hono";
import type { BetEnv } from "../lib/accessAuth.js";

// GET /api/sso — the login hop. The frontend navigates here (never
// fetches: Google's own login can't run inside a fetch/iframe). The
// Cloudflare Access application in front of bet-api intercepts this
// navigation when there's no session yet — Google one-click, allowed
// emails, 24h team session, exactly the hub's own /sso flow. What the
// browser lands on after passing is THIS route, which just bounces
// back to the SPA.
//
// Under /api — the SAME Access application the probe fetches hit — on
// purpose: Access cookies are domain-scoped but the JWT's aud is per
// application, so a cookie minted by a second /auth path app was
// always rejected by the /api app (opaque 302 that redirect:"manual"
// never follows) and login could never survive the probe.
//
// The `return` param is checked against the same origin allowlist CORS
// uses, so the redirect can't be pointed anywhere else.
export function createAuthRouter(frontendOrigins: string[]) {
  const app = new Hono<BetEnv>();

  app.get("/sso", (c) => {
    const requested = c.req.query("return");
    let target = frontendOrigins[0] ?? "http://localhost:5173";
    if (requested) {
      try {
        const origin = new URL(requested).origin;
        if (frontendOrigins.includes(origin)) target = origin;
      } catch {
        // Unparseable return param — fall through to the default origin
        // above. Never error: the visitor already passed Access, the
        // only wrong answer here is a broken page.
      }
    }
    return c.redirect(target, 302);
  });

  return app;
}

export type AuthRouter = ReturnType<typeof createAuthRouter>;