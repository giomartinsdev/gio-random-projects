// Holds the Better Auth bearer token minted for a Discord Activity
// session (see discordActivity.ts). Module-scoped, not React state --
// api.ts/bookclubApi.ts/authClient.ts all need synchronous read access
// to it from plain functions, not components.
//
// Cookies don't work here: Discord Activities load through a
// discordsays.com virtual origin, proxying requests to the real
// backend -- but a Set-Cookie with Domain=.giomartins.dev (post-api's
// cross-subdomain cookie config) is invalid for a response the
// browser sees as coming from discordsays.com, so the browser drops
// it silently. post-api's `bearer` plugin (already enabled for "a
// future Discord bot", see its auth.ts) exists for exactly this kind
// of case -- an Authorization header instead of a cookie.
let token: string | null = null;

export function getDiscordBearerToken(): string | null {
  return token;
}

export function setDiscordBearerToken(t: string | null): void {
  token = t;
}
