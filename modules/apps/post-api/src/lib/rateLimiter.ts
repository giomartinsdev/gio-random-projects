import type { MiddlewareHandler } from "hono";

// Per-IP token bucket, in-memory -- this repo deploys one container
// per service (no horizontal scaling), so "every request lands on
// this same process" always holds here. Anti-abuse throttle for an
// internet-facing endpoint, not a real traffic shaper -- mirrors
// domain-api's own ratelimiter.go and bookclub-api's copy of this
// same file (token bucket per IP, idle buckets evicted so this can't
// leak memory against an endless stream of distinct IPs).
type Bucket = { tokens: number; lastRefill: number };

export function createRateLimiter(opts: { requestsPerMinute: number; burst: number }): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = opts.requestsPerMinute / 60_000;
  const idleTTLMs = 10 * 60_000;

  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) {
      if (now - b.lastRefill > idleTTLMs) buckets.delete(ip);
    }
  }, idleTTLMs).unref();

  return async (c, next) => {
    const ip =
      c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) {
      b = { tokens: opts.burst, lastRefill: now };
      buckets.set(ip, b);
    } else {
      b.tokens = Math.min(opts.burst, b.tokens + (now - b.lastRefill) * refillPerMs);
      b.lastRefill = now;
    }

    if (b.tokens < 1) {
      return c.json({ error: "too many requests" }, 429);
    }
    b.tokens -= 1;
    await next();
  };
}
