# contas-api: one of the 4 backends behind financas-frontend (the
# personal-finance feature -- see modules/apps/contas-api's own
# README). Auth is financas' own Google Sign-In + session cookie, not
# Cloudflare Access: contas-api verifies the Google ID token the
# frontend's Identity Services button hands it, then mints the
# financas_session cookie the other 3 backends only verify. There is
# no local database at all -- accounts and their balances persist
# through domain-api's shared Postgres via its command pipeline, so
# this container is stateless (no docker_volume). The published
# loopback port is what ingress routes contas-api.giomartins.dev to
# (locals.tf's services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "contas_api" {
  name    = "contas-api"
  image   = "${var.registry_host}/contas-api:latest"
  restart = "unless-stopped"

  env = [
    # Session issuing: contas-api verifies the Google ID token
    # (audience must match google_oauth_client_id) and mints the
    # financas_session cookie other backends only verify, signed with
    # this shared secret and scoped to session_cookie_domain so all 4
    # subdomains can read it.
    "FINANCAS_SESSION_SECRET=${var.session_secret}",
    "FINANCAS_SESSION_COOKIE_DOMAIN=${var.session_cookie_domain}",
    "FINANCAS_SESSION_DURATION=${var.session_duration_seconds}",
    "GOOGLE_OAUTH_CLIENT_ID=${var.google_oauth_client_id}",
    # Optional restriction beyond "any Google account" -- empty by
    # default, financas is open signup.
    "CONTAS_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the financas-frontend SPA's MinIO-served
    # origin) -- the CORS allowlist and /api/sso's return-parameter
    # allowlist, plus localhost dev like bet-api/harness-api's.
    "CONTAS_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Persistence: accounts go through domain-api's command pipeline
    # instead of any local store. Container-to-container on
    # network_name (both join the same bridge network) -- same
    # pattern as post-api/bookclub-api/classroom-api, not the
    # network_mode=host loopback trick cch-api uses.
    "CONTAS_DOMAIN_API_URL=${var.domain_api_url}",
    "CONTAS_DOMAIN_API_KEY=${var.domain_api_key}",
    # Traces + metrics only -- logs flow via alloy's docker-socket
    # scrape of this container's stdout.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=contas-api",
    "PORT=8011",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8011
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
