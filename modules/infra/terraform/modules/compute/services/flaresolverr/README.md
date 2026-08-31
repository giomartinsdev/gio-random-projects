# module "compute/services/flaresolverr"

The deals scrapers' challenge solver. When one of the polled sources'
edges answers a plain fetch with Cloudflare's JS challenge
(`cf-mitigated: challenge`, "Just a moment..."), no amount of TLS
fingerprinting passes — it needs a real browser. [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
is exactly that: one container running an embedded headless browser,
exposing a small API that loads a URL, waits out (or solves) the
challenge, and returns the session cookies it won — chiefly
`cf_clearance`.

- **`flaresolverr`** — image pinned at `var.flaresolverr_image`
  (default `ghcr.io/flaresolverr/flaresolverr:v3.5.0`). No published
  ports; only reachable in-network as `http://flaresolverr:8191`
  (output `url`). No volume — every solve is fresh, sessions aren't
  kept. Memory capped at 768MB (idle it's a slim java/python process;
  solving is the only moment it grows).

## Who uses it, and when

Nobody on a timer. The only callers are the deals scrapers
(`modules/compute/apps/deals_scraper`, wired from the root's
`flaresolverr_url = module.compute_services_flaresolverr.url`), and
they call it reactively: `deals_common.fetch.HttpClient` fetches
through Scrapling's static Fetcher first and only — on a 403 marked
`cf-mitigated: challenge` — hands the URL to this container once,
stashes the returned `cf_clearance` + user-agent, and reuses them on
every subsequent call. A source that never puts up a challenge leaves
this container idle forever, cost included.

## Versioning note

The *default* branch's `:latest` tag is deliberately NOT used here —
solver logic ages against Cloudflare's changes, so the tag is pinned.
When a poller suddenly starts 403-ing again, try bumping
`flaresolverr_image` FIRST (v3.5.0+ resolves Cloudflare Turnstile) —
that's the fix ninety percent of the time, and the fetch layer will
log `flaresolverr solve failed` if it stops working outright.