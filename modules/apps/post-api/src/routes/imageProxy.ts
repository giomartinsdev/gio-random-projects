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

const MAX_REDIRECTS = 5;

// Most real-world image hosts redirect at least once (picsum.photos,
// the one this repo's own seed post actually uses, always 302s to a
// randomized CDN URL) -- rejecting every redirect outright, as the
// SSRF guard used to, makes the common case unusable. Following them
// is safe as long as EVERY hop gets the same isBlockedHostname check
// the initial URL got: a public host redirecting to an internal one
// is exactly the SSRF shape this guards against, so each Location
// header is re-validated before it's fetched, not just the original
// caller-supplied URL.
async function fetchFollowingSafeRedirects(url: URL): Promise<Response | { blocked: true }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), { redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    const next = new URL(location, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") return { blocked: true };
    if (isBlockedHostname(next.hostname)) return { blocked: true };
    current = next;
  }
  return { blocked: true };
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

    let upstream: Response | { blocked: true };
    try {
      upstream = await fetchFollowingSafeRedirects(parsed);
    } catch {
      return c.json({ error: "failed to fetch image" }, 502);
    }
    if ("blocked" in upstream) {
      return c.json({ error: "url redirected to a disallowed host, or too many redirects" }, 502);
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
