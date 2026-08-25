import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";

// Discord always appends this when it launches the app as an
// Activity (iframed inside a voice channel / the Activities panel)
// -- absent on every normal browser visit, which is how this whole
// module gets skipped entirely outside Discord. See main.tsx for the
// call site.
export function isDiscordActivity(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

// Discord Activities load through a Discord-owned virtual origin
// (https://<client_id>.discordsays.com/), not the real one -- every
// cross-origin request this app makes (post-api, bookclub-api) has to
// be rewritten to go through Discord's own proxy instead, or the
// iframe's CSP blocks it outright. patchUrlMappings monkey-patches
// window.fetch/XHR/WebSocket globally so api.ts/bookclubApi.ts's
// existing absolute-URL calls keep working completely unmodified --
// the prefixes below MUST match the "URL Mappings" configured for
// this app in the Discord Developer Portal exactly, prefix for
// prefix, or the rewrite has nowhere to route to.
function targetHost(url: string): string {
  return new URL(url).host;
}

export async function initDiscordActivity(): Promise<void> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) {
    console.error("[discord-activity] VITE_DISCORD_CLIENT_ID is not set -- skipping Discord SDK init.");
    return;
  }

  patchUrlMappings([
    { prefix: "/postapi", target: targetHost(import.meta.env.VITE_POST_API_URL as string) },
    { prefix: "/bookclubapi", target: targetHost(import.meta.env.VITE_BOOKCLUB_API_URL as string) },
  ]);

  const discordSdk = new DiscordSDK(clientId);
  await discordSdk.ready();

  // authorize (get a one-time code) -> exchange it server-side for an
  // access_token (client_secret can never touch the browser) ->
  // authenticate (hands the token back to Discord's client so it
  // knows who's using the activity). None of this touches this
  // site's own Better Auth session -- that's still the separate,
  // regular email/password login inside the embedded page. This step
  // is what makes Discord treat the iframe as a legitimate,
  // authorized Activity at all; skipping it leaves the panel blank
  // in most Discord clients.
  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const tokenRes = await fetch(`${import.meta.env.VITE_POST_API_URL}/discord/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!tokenRes.ok) {
    console.error("[discord-activity] token exchange failed:", await tokenRes.text());
    return;
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  await discordSdk.commands.authenticate({ access_token });
}
