# bookclub-api: realtime PDF room service ("Clube do Livro"). Shares
# compute_data's Postgres with post-api (same DATABASE_URL shape) and
# reuses post-api's OWN Better Auth secret (var.better_auth_secret,
# passed in as the same value, not a new one) so a session created at
# post-api.giomartins.dev also validates here -- see
# modules/apps/bookclub-api/src/lib/auth.ts for why that only works if
# the secret genuinely matches.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"
}

# One-shot: applies this service's OWN drizzle migrations
# (bookclub_document, the PDF blob table -- room/message live in
# domain-api/domain-worker's own migration now, not here; NOT Better
# Auth's tables either, already created by post-api's own migrate
# container against this same database). Same must_run=false +
# attach=true pattern as post_api_migrate.
resource "docker_container" "bookclub_api_migrate" {
  name       = "bookclub-api-migrate"
  image      = "${var.registry_host}/bookclub-api:latest"
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

resource "docker_container" "bookclub_api" {
  name    = "bookclub-api"
  image   = "${var.registry_host}/bookclub-api:latest"
  restart = "unless-stopped"

  depends_on = [docker_container.bookclub_api_migrate]

  env = [
    "DATABASE_URL=${local.database_url}",
    "BETTER_AUTH_SECRET=${var.better_auth_secret}",
    "BETTER_AUTH_URL=https://${var.hostname}",
    "DOMAIN_API_URL=${var.domain_api_url}",
    "DOMAIN_API_KEY=${var.domain_api_key}",
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    "PORT=8000",
  ]

  ports {
    internal = 8000
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
