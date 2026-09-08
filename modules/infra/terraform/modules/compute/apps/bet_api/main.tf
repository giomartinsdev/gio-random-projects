# bet-api: the betting BFF (Hono + Drizzle) -- see modules/apps/bet-api's
# own README. Auth is Cloudflare Access on the public hostname (the
# edge injects Cf-Access-Jwt-Assertion, the app verifies the JWT itself
# -- no Better Auth here), and the bet-runner reaches /internal/*
# container-to-container with RUNNER_API_KEY. Depends on postgres being
# up and reachable by name on the same network -- not a Terraform
# dependency (no shared resource reference), just a runtime one.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"
}

# One-shot: applies the Drizzle migrations against the shared Postgres
# before bet_api starts -- same must_run=false + attach=true pattern as
# post_api's migrate container (CI re-runs it with -replace, see
# ts-backend-ci-cd.yml's case for bet-api).
resource "docker_container" "bet_api_migrate" {
  name       = "bet-api-migrate"
  image      = "${var.registry_host}/bet-api:latest"
  entrypoint = ["node"]
  command    = ["dist/db/migrate.js"]
  must_run   = false
  attach     = true

  env = [
    "DATABASE_URL=${local.database_url}",
  ]

  networks_advanced {
    name = var.network_name
  }
}

resource "docker_container" "bet_api" {
  name    = "bet-api"
  image   = "${var.registry_host}/bet-api:latest"
  restart = "unless-stopped"

  depends_on = [docker_container.bet_api_migrate]

  env = [
    "DATABASE_URL=${local.database_url}",
    # Access JWT validation (lib/accessAuth.ts): the team's JWKS and
    # the audience tag of this app's Access application (/api, login
    # hop included), comma-joined; the middleware pins the set.
    "BET_ACCESS_TEAM_DOMAIN=${var.access_team_domain}",
    "BET_ACCESS_AUD=${join(",", var.access_aud)}",
    # Defense-in-depth email allowlist after the JWT verifies (the edge
    # policy enforces the same list).
    "BET_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Bookmaker credentials at rest (AES-256-GCM, lib/crypto.ts).
    "BET_CREDENTIALS_KEY=${var.credentials_key}",
    # /internal/* guard -- bet-runner's claim/report calls.
    "RUNNER_API_KEY=${var.runner_api_key}",
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Traces + metrics only — logs flow via alloy's docker-socket scrape
    # of this container's stdout (see otlp_endpoint's description).
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=bet-api",
    "PORT=8009",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8009
    external = var.external_port
  }

  networks_advanced {
    name = var.network_name
  }

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}