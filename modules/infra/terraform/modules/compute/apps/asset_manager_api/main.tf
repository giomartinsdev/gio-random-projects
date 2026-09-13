# asset-manager-api: one of the 4 backends behind financas-frontend
# (the personal-finance feature -- see modules/apps/asset-manager-api's
# own README). Auth is financas' own session cookie: contas-api is the
# one service that verifies the Google ID token and mints it, this
# service only verifies it. There is no local database at all -- assets
# and their movements persist through domain-api's shared Postgres via
# its command pipeline, so this container is stateless (no
# docker_volume). It also calls out to brapi.dev for market quotes
# (ASSET_MANAGER_BRAPI_TOKEN). The published loopback port is what
# ingress routes asset-manager-api.giomartins.dev to (locals.tf's
# services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "asset_manager_api" {
  name    = "asset-manager-api"
  image   = "${var.registry_host}/asset-manager-api:latest"
  restart = "unless-stopped"

  env = [
    # Session verification: the same HS256 secret contas-api signs the
    # financas_session cookie with -- this service never issues one.
    "FINANCAS_SESSION_SECRET=${var.session_secret}",
    # Optional restriction beyond "any Google account" -- empty by
    # default, financas is open signup.
    "ASSET_MANAGER_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the financas-frontend SPA's MinIO-served
    # origin) -- the CORS allowlist and /api/sso's return-parameter
    # allowlist, plus localhost dev like bet-api/harness-api's.
    "ASSET_MANAGER_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Persistence: assets/movements go through domain-api's command
    # pipeline instead of any local store. Loopback since this
    # container publishes a port rather than running
    # network_mode=host -- domain-api publishes 127.0.0.1:8000 on the
    # same VPS.
    "ASSET_MANAGER_DOMAIN_API_URL=${var.domain_api_url}",
    "ASSET_MANAGER_DOMAIN_API_KEY=${var.domain_api_key}",
    # brapi.dev token for stock/fund quote lookups -- never a real
    # value here, only the variable reference (var.brapi_token, no
    # default; see this module's own variables.tf).
    "ASSET_MANAGER_BRAPI_TOKEN=${var.brapi_token}",
    # Traces + metrics only -- logs flow via alloy's docker-socket
    # scrape of this container's stdout.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=asset-manager-api",
    "PORT=8013",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8013
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
