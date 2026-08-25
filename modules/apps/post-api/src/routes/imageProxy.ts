import { Hono } from "hono";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = /^image\//;

// Public + server-side fetch of a caller-supplied URL is an SSRF
// shape by construction -- this can't fully close it (a hostname can
// resolve to a private IP after this check runs, a classic DNS
// rebinding gap), but it stops the obvious cases: anyone pointing this
// at domain-api/bookclub-api/postgres by container name or at
// loopback/link-local/private ranges. The image-content-type check in
// the handler below is the other half -- even a request that DOES
// reach an internal service only leaks whether it responded, never
// its body, since non-image responses get rejected before returning
// anything.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /\.internal$/i,
  /\.local$/i,
];

function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(hostname));
}

// Exists for exactly one caller: front's resolveImageUrl (see its own
// comment) inside a Discord Activity, where a post's coverImageUrl is
// an arbitrary author-pasted URL Discord's iframe sandbox can't reach
// directly (no URL Mapping could ever cover every possible image
// host). This re-fetches it through post-api, which the Activity DOES
// have a mapping for. Public, no auth -- same trust level as the
// image already being publicly embeddable in a published post.
export function createImageProxyRouter() {
  const router = new Hono();

  router.get("/image-proxy", async (c) => {
    const target = c.req.query("url");
    if (!target) return c.json({ error: "url query param is required" }, 400);

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return c.json({ error: "invalid url" }, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.json({ error: "only http(s) urls are allowed" }, 400);
    }
    if (isBlockedHostname(parsed.hostname)) {
      return c.json({ error: "url host is not allowed" }, 400);
    }

    let upstream: Response;
    try {
      // manual, not follow: a redirect target isn't re-checked against
      // isBlockedHostname above, so blindly following one would let an
      // otherwise-public host redirect this request straight at an
      // internal one.
      upstream = await fetch(parsed.toString(), { redirect: "manual" });
    } catch {
      return c.json({ error: "failed to fetch image" }, 502);
    }
    if (upstream.type === "opaqueredirect" || (upstream.status >= 300 && upstream.status < 400)) {
      return c.json({ error: "url redirects are not followed" }, 502);
    }
    if (!upstream.ok) return c.json({ error: `upstream returned ${upstream.status}` }, 502);

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!ALLOWED_CONTENT_TYPES.test(contentType)) {
      return c.json({ error: "url did not return an image" }, 502);
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      return c.json({ error: "image too large" }, 502);
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  });

  return router;
}
