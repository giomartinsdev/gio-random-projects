import { patchUrlMappings } from "@discord/embedded-app-sdk";

// Must run before ANY module that creates a fetch-based client
// (authClient.ts, api.ts, bookclubApi.ts) is evaluated -- those
// capture whatever `fetch` is on `window` at their own module-load
// time (Better Auth's client does this internally), and a Discord
// Activity needs every cross-origin request rewritten to the
// discordsays.com proxy from the very first call, not just calls made
// after initDiscordActivity() gets around to running. main.tsx imports
// this file first, before anything else (including App.js, which
// transitively imports authClient.js), to guarantee that ordering. See
// discordActivity.ts for the rest of the auth flow and post-api/
// bookclub-api READMEs for why these prefixes exist.
if (new URLSearchParams(window.location.search).has("frame_id")) {
  patchUrlMappings([
    { prefix: "/postapi", target: new URL(import.meta.env.VITE_POST_API_URL as string).host },
    { prefix: "/bookclubapi", target: new URL(import.meta.env.VITE_BOOKCLUB_API_URL as string).host },
  ]);
}
