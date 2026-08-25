import { createAuthClient } from "better-auth/react";
import { getDiscordBearerToken } from "./discordAuthToken.js";

// Cookie-based session (Better Auth's client default) for a normal
// browser visit -- `credentials: "include"` on every fetch (set here
// and in api.ts) plus CORS configured server-side (post-api's app.ts)
// covers that case. Inside a Discord Activity, cookies don't work at
// all (see discordAuthToken.ts) -- `auth.type: "Bearer"` re-evaluates
// its token getter on every request, so it's a no-op (undefined,
// header omitted) until discordActivity.ts's sign-in flow sets one,
// at which point every subsequent request -- including this client's
// own internal getSession() -- starts authenticating as that user.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_POST_API_URL,
  fetchOptions: {
    credentials: "include",
    auth: {
      type: "Bearer",
      token: () => getDiscordBearerToken() ?? undefined,
    },
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
