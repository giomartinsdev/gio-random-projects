import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Auth } from "./lib/auth.js";
import type { DomainApiClient } from "./lib/domainApiClient.js";
import type { Db } from "./db/index.js";
import { docsHtml, openApiYaml } from "./lib/openapi.js";
import { createPostsRouter } from "./routes/posts.js";
import { createFeedRouter } from "./routes/feed.js";
import { createUsersRouter } from "./routes/users.js";
import { createDiscordRouter } from "./routes/discord.js";
import { createImageProxyRouter } from "./routes/imageProxy.js";
import { createRateLimiter } from "./lib/rateLimiter.js";

export function createApp(
  auth: Auth,
  domainApi: DomainApiClient,
  frontendOrigins: string[],
  db: Db,
  discord?: { clientId: string; clientSecret: string },
) {
  const app = new Hono();
  // First configured origin is the canonical public site -- used to
  // build absolute <link>/<guid> URLs in the RSS feed below.
  const siteUrl = frontendOrigins[0] ?? "http://localhost:5173";

  // credentials: true because Better Auth's browser client also sets
  // a session cookie alongside the bearer token -- without it, the
  // browser silently drops that cookie on a cross-origin response.
  app.use(
    "*",
    cors({
      origin: frontendOrigins,
      credentials: true,
      // traceparent/tracestate/baggage: the frontend's fetch
      // instrumentation (buteco-class-frontend/src/telemetry.ts) adds
      // these to every call — a preflight that doesn't allow them kills
      // the request before it starts.
      allowHeaders: ["content-type", "authorization", "traceparent", "tracestate", "baggage"],
    }),
  );

  app.use("*", secureHeaders());

  app.use("/posts/*", createRateLimiter({ requestsPerMinute: 60, burst: 100 }));
  app.use("/discord/*", createRateLimiter({ requestsPerMinute: 20, burst: 20 }));
  app.use("/image-proxy", createRateLimiter({ requestsPerMinute: 60, burst: 60 }));
  // /users/:id/view is the one POST an idle profile page fires; the
  // same budget protects it without making a read-heavy profile
  // session feel throttled.
  app.use("/users/*", createRateLimiter({ requestsPerMinute: 60, burst: 60 }));

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/posts", createPostsRouter(auth, domainApi, db));
  app.route("/users", createUsersRouter(auth, db));
  app.route("/", createFeedRouter(domainApi, siteUrl));
  app.route("/", createImageProxyRouter());

  // Opt-in: absent until DISCORD_CLIENT_ID/SECRET are configured (see
  // README), so this stays a total no-op for every environment that
  // hasn't set up the Discord Activity yet -- including every
  // existing test.
  if (discord) {
    app.route("/discord", createDiscordRouter(discord.clientId, discord.clientSecret));
  }

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public — no auth, same reasoning as domain-api's own docs.go:
  // documentation, not data, gating it would just make it unreachable
  // for anyone deciding whether to sign up at all.
  app.get("/openapi.yaml", (c) => c.text(openApiYaml, 200, { "content-type": "application/yaml" }));
  app.get("/docs", (c) => c.html(docsHtml));

  return app;
}

export type App = ReturnType<typeof createApp>;
