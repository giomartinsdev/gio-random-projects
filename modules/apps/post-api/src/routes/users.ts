import { Hono } from "hono";
import type { Auth } from "../lib/auth.js";
import { getPublicUser, profileViewCount, recordProfileView } from "../lib/engagement.js";
import type { Db } from "../db/index.js";

async function requireAuth(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

// Public identity + the counter for "how many people have seen this
// profile". Views are a separate POST (not a side effect of the GET):
// reads stay idempotent/repeatable for any client, and only
// authenticated viewers are ever counted -- tracking anonymous
// visitors would need fingerprinting, which isn't worth it for a
// community site (the UI labels the number accordingly).
export function createUsersRouter(auth: Auth, db: Db) {
  const router = new Hono();

  router.get("/:id", async (c) => {
    const profile = await getPublicUser(db, c.req.param("id"));
    if (!profile) return c.json({ error: "not found" }, 404);
    return c.json({ user: profile, viewCount: await profileViewCount(db, profile.id) });
  });

  router.post("/:id/view", async (c) => {
    const viewerId = await requireAuth(auth, c);
    if (!viewerId) return c.json({ error: "unauthorized" }, 401);

    const profile = await getPublicUser(db, c.req.param("id"));
    if (!profile) return c.json({ error: "not found" }, 404);

    return c.json(await recordProfileView(db, profile.id, viewerId));
  });

  return router;
}