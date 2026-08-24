import { Hono } from "hono";
import type { Auth } from "./lib/auth.js";
import type { DomainApiClient } from "./lib/domainApiClient.js";
import { createPostsRouter } from "./routes/posts.js";

export function createApp(auth: Auth, domainApi: DomainApiClient) {
  const app = new Hono();

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/posts", createPostsRouter(auth, domainApi));

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
