import { Hono } from "hono";
import type { Db } from "./db/index.js";
import type { Auth } from "./lib/auth.js";
import { createPostsRouter } from "./routes/posts.js";

export function createApp(db: Db, auth: Auth) {
  const app = new Hono();

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/posts", createPostsRouter(db, auth));

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
