import { Hono } from "hono";
import type { Auth } from "./lib/auth.js";
import type { DomainApiClient } from "./lib/domainApiClient.js";
import { docsHtml, openApiYaml } from "./lib/openapi.js";
import { createPostsRouter } from "./routes/posts.js";

export function createApp(auth: Auth, domainApi: DomainApiClient) {
  const app = new Hono();

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/posts", createPostsRouter(auth, domainApi));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public — no auth, same reasoning as domain-api's own docs.go:
  // documentation, not data, gating it would just make it unreachable
  // for anyone deciding whether to sign up at all.
  app.get("/openapi.yaml", (c) => c.text(openApiYaml, 200, { "content-type": "application/yaml" }));
  app.get("/docs", (c) => c.html(docsHtml));

  return app;
}

export type App = ReturnType<typeof createApp>;
