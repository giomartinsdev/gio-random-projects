# dashboard-api: one of the 4 backends behind financas-frontend (the
# personal-finance feature -- see modules/apps/dashboard-api's own
# README). Auth is financas' own session cookie: contas-api is the one
# service that verifies the Google ID token and mints it, this service
# only verifies it. There is no local database at all -- dashboard
# layouts and their aggregated views persist through domain-api's
# shared Postgres via its command pipeline, so this container is
# stateless (no docker_volume). The published loopback port is what
# ingress routes dashboard-api.giomartins.dev to (locals.tf's
# services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "dashboard_api" {
  name    = "dashboard-api"
  image   = "${var.registry_host}/dashboard-api:latest"
  restart = "unless-stopped"

  env = [
    # Session verification: the same HS256 secret contas-api signs the
    # financas_session cookie with -- this service never issues one.
    "FINANCAS_SESSION_SECRET=${var.session_secret}",
    # Optional restriction beyond "any Google account" -- empty by
    # default, financas is open signup.
    "DASHBOARD_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the financas-frontend SPA's MinIO-served
    # origin) -- the CORS allowlist and /api/sso's return-parameter
    # allowlist, plus localhost dev like bet-api/harness-api's.
    "DASHBOARD_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Persistence: dashboard layouts go through domain-api's command
    # pipeline instead of any local store. Loopback since this
    # container publishes a port rather than running
    # network_mode=host -- domain-api publishes 127.0.0.1:8000 on the
    # same VPS.
    "DASHBOARD_DOMAIN_API_URL=${var.domain_api_url}",
    "DASHBOARD_DOMAIN_API_KEY=${var.domain_api_key}",
    # Traces + metrics only -- logs flow via alloy's docker-socket
    # scrape of this container's stdout.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=dashboard-api",
    "PORT=8014",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8014
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
