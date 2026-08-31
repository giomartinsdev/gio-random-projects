# FlareSolverr: a headless-browser-in-a-container that solves Cloudflare
# "Just a moment..." challenges (the 2026-04+ Turnstile-flavored ones —
# v3.5.0's solver) and returns cf_clearance cookies. Internal-only: no
# published ports, reachable only from the apps network as
# http://flaresolverr:8191. Its challenge-gated consumer is the deals
# scrapers, which activate it ONLY on a `cf-mitigated: challenge` 403 —
# a normal 200 never spawns a browser here.
#
# Versioning note: this image is pinned (not :latest) on purpose — but
# challenge solvers age badly: when a poller suddenly starts 403-ing
# again, try bumping flaresolverr_image FIRST (Cloudflare moves faster
# than this tag does).
resource "docker_container" "flaresolverr" {
  name    = "flaresolverr"
  image   = var.flaresolverr_image
  restart = "unless-stopped"

  env = [
    "LOG_LEVEL=info",
  ]

  networks_advanced {
    name = var.network_name
  }

  # One solve per scrape cycle at most (chromium render + Turnstile) --
  # bursts would OOM-cheapen this; idle sits around 200MB.
  memory = 768

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }
}