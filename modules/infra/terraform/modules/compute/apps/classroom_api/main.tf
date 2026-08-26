# classroom-api: realtime video/notepad/chat service ("Aulas"). Reuses
# post-api's OWN Better Auth secret (var.better_auth_secret, passed in
# as the same value, not a new one) so a session created at
# post-api.giomartins.dev also validates here -- see
# modules/apps/classroom-api/src/lib/auth.ts for why that only works
# if the secret genuinely matches. Unlike bookclub_api, there's no
# migrate container here at all: this service owns no Postgres tables
# of its own (DATABASE_URL is only ever used to validate sessions
# against post-api's already-migrated user/session tables).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"
}

resource "docker_container" "classroom_api" {
  name    = "classroom-api"
  image   = "${var.registry_host}/classroom-api:latest"
  restart = "unless-stopped"

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
