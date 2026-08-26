# 9router: a smart OpenAI-compatible proxy that auto-falls back across
# 40+ AI providers (Claude, GPT, Gemini, …) and saves ~20-40% tokens
# via RTK compression. Exposes:
#   - Dashboard: /dashboard  (login with INITIAL_PASSWORD)
#   - API:       /v1         (OpenAI-compatible endpoint for CLI tools)
#
# Published on the host so it's reachable directly as ai.giomartins.dev
# (grey-cloud record → server_ip) or http://server_ip:20128.

resource "docker_volume" "ninerouter_data" {
  name = "ninerouter_data"
}

resource "docker_container" "ninerouter" {
  name    = "9router"
  image   = "ghcr.io/decolua/9router:${var.image_tag}"
  restart = "unless-stopped"

  env = [
    # Required secrets — Terraform-generated, never committed in plain text.
    "JWT_SECRET=${var.jwt_secret}",
    "INITIAL_PASSWORD=${var.initial_password}",

    # Runtime config
    "PORT=20128",
    "NODE_ENV=production",

    # Must point to the externally-visible URL so that internal sync
    # jobs (cloud sync, etc.) can call back into /api/sync/cloud and
    # resolve correctly — same reasoning as Vaultwarden's DOMAIN var.
    "BASE_URL=https://${var.hostname}",
    "NEXT_PUBLIC_BASE_URL=https://${var.hostname}",

    # Always served behind Cloudflare (HTTPS) — mark session cookies
    # Secure so browsers won't send them over plain HTTP.
    "AUTH_COOKIE_SECURE=true",

    # API key enforcement: false here lets Antigravity/Claude Code hit
    # /v1 with a Bearer token configured in the tool itself, without
    # needing an extra layer of enforcement at this level. Set to true
    # and configure keys through the dashboard if you want stricter
    # access control on the /v1 endpoint.
    "REQUIRE_API_KEY=false",

    # Persist structured request logs to DATA_DIR — useful for
    # debugging provider fallbacks without tailing container stdout.
    "ENABLE_REQUEST_LOGS=true",
    "OBSERVABILITY_ENABLED=true",

    # DATA_DIR is where 9router stores its SQLite state, provider
    # connections, and logs — must match the volume mount target below.
    "DATA_DIR=/app/data",
  ]

  # Data volume: provider connections, API keys, session state,
  # request logs. Survives container replacement on image upgrades.
  mounts {
    type   = "volume"
    source = docker_volume.ninerouter_data.name
    target = "/app/data"
  }

  # Published so the dashboard/API is reachable on the host directly
  # (grey-cloud DNS → server_ip, or the raw IP). Without this binding,
  # nothing outside the docker network can reach it — same reason
  # vaultwarden publishes 8222 and minio publishes 9001.
  ports {
    internal = 20128
    external = 20128
  }

  # Reachable by container name ("9router") on the shared apps
  # network — future modules can reach /v1 without leaving the host
  # (lower latency, no public hop).
  networks_advanced {
    name = var.network_name
  }
}
