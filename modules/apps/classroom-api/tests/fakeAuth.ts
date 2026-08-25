import type { Auth } from "../src/lib/auth.js";

// Stands in for post-api's real session validation (same "fake the
// other system's contract" approach bookclub-api/post-api's own tests
// use for domain-api). A request is "logged in" as whatever
// x-fake-user-id/-name headers carry; absent headers means no
// session, same as a logged-out browser.
export function fakeAuth(): Auth {
  return {
    api: {
      async getSession({ headers }: { headers: Headers }) {
        const id = headers.get("x-fake-user-id");
        const name = headers.get("x-fake-user-name");
        if (!id || !name) return null;
        return {
          session: { id: "fake-session", userId: id },
          user: { id, name, email: `${id}@example.com` },
        };
      },
    },
  } as unknown as Auth;
}

export function authHeaders(userId: string, userName: string): Record<string, string> {
  return { "x-fake-user-id": userId, "x-fake-user-name": userName };
}
