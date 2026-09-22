# clubs-api: the FC Clubs Hub backend (clubs.giomartins.dev).
#
# The hub is a public encyclopedia of Pro Clubs data plus an optional personal
# layer: a visitor with no account reads the whole dataset, and logging in is
# what lets the hub discover and sync that person's own clubs. That split is why
# the bare hostname is PUBLIC and only the /api path sits behind Access (see
# path_protected_hostnames in locals.tf) -- the same shape as hub/sso and
# bet-api/api.
#
# No database of its own, and no docker_volume: every read and write goes
# through domain-api over the shared bridge network (the contas_api pattern, not
# cch-api's network_mode=host loopback trick).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "clubs_api" {
  name    = "clubs-api"
  image   = "${var.registry_host}/clubs-api:latest"
  restart = "unless-stopped"

  env = [
    "PORT=8017",
    # Cross-origin caller (the SPA's MinIO-served origin, plus localhost dev)
    # -- the CORS allowlist.
    "CLUBS_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Identity: Cloudflare Access, verified here rather than trusted from the
    # edge -- the same ingress also routes direct traffic.
    "CLUBS_ACCESS_TEAM_DOMAIN=${var.access_team_domain}",
    "CLUBS_ACCESS_AUD=${var.access_aud}",
    "CLUBS_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Persistence: no driver, HTTP + X-API-Key to domain-api.
    "CLUBS_DOMAIN_API_URL=${var.domain_api_url}",
    "CLUBS_DOMAIN_API_KEY=${var.domain_api_key}",
    # Traces + metrics only -- logs flow via alloy's stdout scrape.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=clubs-api",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8017
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
