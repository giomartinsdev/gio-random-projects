import { Hono } from "hono";

// Discord Activity OAuth handshake, server-side half. The Activity
// (front, running inside Discord's iframe) gets a one-time `code`
// from discordSdk.commands.authorize() and posts it here -- this is
// the ONLY place DISCORD_CLIENT_SECRET is allowed to exist, since the
// browser-side code is, by definition, visible to whoever's running
// the Activity. See front/src/lib/discordActivity.ts for the other
// half of this flow.
export function createDiscordRouter(clientId: string, clientSecret: string) {
  const router = new Hono();

  router.post("/token", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => ({ code: undefined }));
    if (!body.code) return c.json({ error: "code is required" }, 400);

    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: body.code,
      }),
    });

    if (!res.ok) {
      return c.json({ error: "discord token exchange failed" }, 502);
    }
    const data = (await res.json()) as { access_token: string };
    return c.json({ access_token: data.access_token });
  });

  return router;
}
