import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Auth } from "./lib/auth.js";
import type { DomainApiClient } from "./lib/domainApiClient.js";
import { docsHtml, openApiYaml } from "./lib/openapi.js";
import { createPostsRouter } from "./routes/posts.js";
import { createRateLimiter } from "./lib/rateLimiter.js";

export function createApp(auth: Auth, domainApi: DomainApiClient, frontendOrigins: string[]) {
  const app = new Hono();

  // credentials: true because Better Auth's browser client also sets
  // a session cookie alongside the bearer token -- without it, the
  // browser silently drops that cookie on a cross-origin response.
  app.use(
    "*",
    cors({
      origin: frontendOrigins,
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
    }),
  );

  app.use("*", secureHeaders());

  app.use("/posts/*", createRateLimiter({ requestsPerMinute: 60, burst: 100 }));

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
