# post-api: headless post CRUD API (Better Auth + a domain-api HTTP
# client) -- see modules/apps/post-api's own README for why it owns no
# post storage of its own. Depends on compute_data (postgres) and
# implicitly on compute_app's domain-api container being reachable by
# name on the same network -- not a Terraform dependency (no shared
# resource reference), just a runtime one.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"
}

# One-shot: applies Better Auth's Drizzle migrations against the
# shared Postgres before post_api starts -- same must_run=false +
# attach=true pattern as modules/compute/registry's htpasswd_init.
resource "docker_container" "post_api_migrate" {
  name       = "post-api-migrate"
  image      = "${var.registry_host}/post-api:latest"
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

resource "docker_container" "post_api" {
  name    = "post-api"
  image   = "${var.registry_host}/post-api:latest"
  restart = "unless-stopped"

  depends_on = [docker_container.post_api_migrate]

  env = [
    "DATABASE_URL=${local.database_url}",
    "BETTER_AUTH_SECRET=${var.better_auth_secret}",
    "BETTER_AUTH_URL=https://${var.hostname}",
    "DOMAIN_API_URL=${var.domain_api_url}",
    "DOMAIN_API_KEY=${var.domain_api_key}",
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    "DISCORD_CLIENT_ID=${var.discord_client_id}",
    "DISCORD_CLIENT_SECRET=${var.discord_client_secret}",
    # Traces + metrics only — logs flow via alloy's docker-socket scrape
    # of this container's stdout (see otlp_endpoint's description).
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=post-api",
    "PORT=8000",
  ]

  ports {
    ip       = "127.0.0.1"
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
