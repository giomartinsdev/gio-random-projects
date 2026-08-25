import { DiscordSDK } from "@discord/embedded-app-sdk";
import { setDiscordBearerToken } from "./discordAuthToken.js";
import { authClient } from "./authClient.js";

// Discord always appends this when it launches the app as an
// Activity (iframed inside a voice channel / the Activities panel)
// -- absent on every normal browser visit, which is how this whole
// module gets skipped entirely outside Discord. See main.tsx for the
// call site.
export function isDiscordActivity(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

// A post's coverImageUrl is whatever the author pasted -- some
// arbitrary external host Discord's Activity sandbox has no URL
// Mapping for (and never could: the set of possible image hosts is
// unbounded). Route it through post-api's /image-proxy instead, which
// IS covered by the /postapi mapping. No-op outside a Discord
// Activity. Used by PostCard/PostView/PostCreate wherever a post's
// image renders.
//
// Deliberately a RELATIVE /postapi/... path, not the absolute
// VITE_POST_API_URL host: patchUrlMappings (discordUrlPatch.ts) only
// monkey-patches fetch/XHR/WebSocket, and an <img> tag's src never
// goes through any of those -- the browser resolves it natively. An
// absolute cross-origin URL there gets blocked outright by the
// Activity iframe's CSP (silent broken-image icon, no console error,
// no network entry). The relative path is proxied by Discord's own
// infrastructure per the "URL Mappings" config, which every request
// under the discordsays.com origin goes through regardless of how
// it's made.
export function resolveImageUrl(url: string): string {
  if (!url || !isDiscordActivity()) return url;
  return `/postapi/image-proxy?url=${encodeURIComponent(url)}`;
}

// Discord's own console relay (RpcApplicationLogger) JSON-serializes
// whatever gets passed to console.error -- an Error instance's
// message/stack are non-enumerable, so it comes out the other end as
// a bare "[object Object]" with zero diagnostic value. Every step
// below logs a plain string built from this instead of the raw
// error/response.
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export async function initDiscordActivity(): Promise<void> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) {
    console.error("[discord-activity] VITE_DISCORD_CLIENT_ID is not set -- skipping Discord SDK init.");
    return;
  }

  // URL mapping patch already applied by discordUrlPatch.ts, imported
  // first in main.tsx, before this module (and authClient.ts) ever
  // loaded -- see that file for why the ordering matters.
  const discordSdk = new DiscordSDK(clientId);
  try {
    await discordSdk.ready();
  } catch (err) {
    console.error("[discord-activity] sdk.ready() failed:", describeError(err));
    return;
  }
  console.log("[discord-activity] sdk ready");

  // authorize (get a one-time code) -> exchange it server-side for an
  // access_token (client_secret can never touch the browser) ->
  // authenticate (hands the token back to Discord's client so it
  // knows who's using the activity). This is what makes Discord treat
  // the iframe as a legitimate, authorized Activity at all -- skipping
  // it leaves the panel blank in most Discord clients. "email" is
  // requested alongside "identify" because signing into this site
  // below requires one (Better Auth users need an email); Discord
  // shows both as a single combined consent the first time.
  let code: string;
  try {
    ({ code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "email"],
    }));
  } catch (err) {
    console.error("[discord-activity] authorize() failed:", describeError(err));
    return;
  }
  console.log("[discord-activity] authorized, got code");

  let access_token: string;
  try {
    const tokenRes = await fetch(`${import.meta.env.VITE_POST_API_URL}/discord/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!tokenRes.ok) {
      console.error("[discord-activity] token exchange failed:", tokenRes.status, await tokenRes.text());
      return;
    }
    ({ access_token } = (await tokenRes.json()) as { access_token: string });
  } catch (err) {
    console.error("[discord-activity] token exchange threw:", describeError(err));
    return;
  }
  console.log("[discord-activity] got access_token");

  try {
    await discordSdk.commands.authenticate({ access_token });
  } catch (err) {
    console.error("[discord-activity] authenticate() failed:", describeError(err));
    return;
  }
  console.log("[discord-activity] authenticated with discord client");

  // Signs into THIS site as that Discord user (creating an account on
  // first use) -- see auth.ts's `discord` social provider config for
  // why this is safe despite skipping normal id_token verification.
  // The response's `token` is a Better Auth bearer session; stored
  // for discordAuthToken.ts's getters, which authClient.ts/api.ts/
  // bookclubApi.ts all read on every subsequent request. Cookies
  // aren't usable here (see discordAuthToken.ts), so this is the
  // entire sign-in -- there's no separate step, no login form shown.
  let token: string | undefined;
  try {
    const signInRes = await fetch(`${import.meta.env.VITE_POST_API_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "discord",
        idToken: { token: access_token, accessToken: access_token },
      }),
    });
    if (!signInRes.ok) {
      console.error("[discord-activity] site sign-in failed:", signInRes.status, await signInRes.text());
      return;
    }
    ({ token } = (await signInRes.json()) as { token?: string });
  } catch (err) {
    console.error("[discord-activity] site sign-in threw:", describeError(err));
    return;
  }
  if (!token) {
    console.error("[discord-activity] sign-in response had no token");
    return;
  }
  setDiscordBearerToken(token);
  console.log("[discord-activity] signed in, bearer token set");

  // main.tsx fires this before the app even renders, so the app's
  // FIRST session fetch already happened (and came back logged-out --
  // there was no token yet). NavBar/ProtectedRoute etc. all read
  // useSession(), which subscribes to Better Auth's internal
  // $sessionSignal atom -- that atom only flips on a handful of
  // hardcoded paths (/sign-out, /sign-in/email, /update-user, ...)
  // baked into the client library, and neither a plain getSession()
  // call nor our /sign-in/social fetch above is on that list. A raw
  // getSession() call fetches fresh data but the hook never learns
  // about it. $store.notify flips the signal directly, which is what
  // actually makes the session-refresh manager refetch and every
  // useSession() subscriber (NavBar, ProtectedRoute) re-render.
  try {
    authClient.$store.notify("$sessionSignal");
    console.log("[discord-activity] session signal notified, should be logged in now");
  } catch (err) {
    console.error("[discord-activity] session signal notify threw:", describeError(err));
  }
}
