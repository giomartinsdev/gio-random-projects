# apostas-api: the BFF for the Apostas module (betting-house wallet
# reconciliation). Auth is financas' own session cookie: contas-api is
# the one service that verifies the Google ID token and mints it, this
# service only verifies it. There is no local database at all -- bets
# and their money movements persist through domain-api's shared
# Postgres via its command pipeline, so this container is stateless (no
# docker_volume). The published loopback port is what ingress routes
# apostas-api.giomartins.dev to (locals.tf's services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "apostas_api" {
  name    = "apostas-api"
  image   = "${var.registry_host}/apostas-api:latest"
  restart = "unless-stopped"

  env = [
    # Session verification: the same HS256 secret contas-api signs the
    # financas_session cookie with -- this service never issues one.
    "FINANCAS_SESSION_SECRET=${var.session_secret}",
    # Optional restriction beyond "any Google account" -- empty by
    # default, financas is open signup.
    "APOSTAS_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the financas-frontend SPA's MinIO-served
    # origin) -- the CORS allowlist.
    "APOSTAS_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Persistence: bets and transações go through domain-api's command
    # pipeline instead of any local store. Container-to-container on
    # network_name (bridge, not host networking).
    "APOSTAS_DOMAIN_API_URL=${var.domain_api_url}",
    "APOSTAS_DOMAIN_API_KEY=${var.domain_api_key}",
    # The betting-slip Chrome extension's own auth -- a static shared
    # secret (no session cookie exists in a service worker) mapped to
    # one fixed identity, since financas is a single-person product.
    # Empty token disables that route entirely.
    "APOSTAS_EXTENSION_TOKEN=${var.extension_token}",
    "APOSTAS_EXTENSION_USUARIO_EMAIL=${var.extension_usuario_email}",
    # Vision AI for reading a betting-slip screenshot -- 9router on the
    # internal docker network, REQUIRE_API_KEY=false there.
    "APOSTAS_AI_BASE_URL=${var.ai_base_url}",
    "APOSTAS_AI_MODEL=${var.ai_model}",
    # Traces + metrics only -- logs flow via alloy's docker-socket
    # scrape of this container's stdout.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=apostas-api",
    "PORT=8016",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8016
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
