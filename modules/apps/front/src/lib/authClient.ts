import { createAuthClient } from "better-auth/react";

// Cookie-based session (Better Auth's client default) -- post-api's
// bearer plugin exists for non-browser clients (a future Discord
// bot); this browser app just needs `credentials: "include"` on every
// fetch (set here and in api.ts) and CORS configured server-side to
// allow it, which post-api's app.ts already does.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_POST_API_URL,
  fetchOptions: {
    credentials: "include",
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
