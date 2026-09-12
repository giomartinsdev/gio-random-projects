# transacional-api: one of the 4 backends behind financas-frontend (the
# personal-finance feature -- see modules/apps/transacional-api's own
# README). Auth is Cloudflare Access on the public hostname's /api
# path, exactly like harness-api: the edge injects
# Cf-Access-Jwt-Assertion and the app verifies the JWT itself. Unlike
# harness-api there is no local database at all -- transactions persist
# through domain-api's shared Postgres via its command pipeline, so
# this container is stateless (no docker_volume). The published
# loopback port is what ingress routes transacional-api.giomartins.dev
# to (locals.tf's services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "transacional_api" {
  name    = "transacional-api"
  image   = "${var.registry_host}/transacional-api:latest"
  restart = "unless-stopped"

  env = [
    # Access JWT validation: the issuer every Access JWT must carry
    # (the app fetches the team's JWKS from
    # <issuer>/cdn-cgi/access/certs) and the audience tag of this
    # app's Access application (/api, login hop included) -- a token
    # minted for any OTHER Access app is rejected here.
    "TRANSACIONAL_ACCESS_ISSUER=https://${var.access_team_domain}",
    "TRANSACIONAL_ACCESS_AUD=${join(",", var.access_aud)}",
    # Defense-in-depth email allowlist checked after the JWT verifies
    # (the edge's Google-SSO policy already enforces the same list).
    "TRANSACIONAL_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the financas-frontend SPA's MinIO-served
    # origin) -- the CORS allowlist and /api/sso's return-parameter
    # allowlist, plus localhost dev like bet-api/harness-api's.
    "TRANSACIONAL_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Persistence: transactions go through domain-api's command
    # pipeline instead of any local store. Loopback since this
    # container publishes a port rather than running
    # network_mode=host -- domain-api publishes 127.0.0.1:8000 on the
    # same VPS.
    "TRANSACIONAL_DOMAIN_API_URL=${var.domain_api_url}",
    "TRANSACIONAL_DOMAIN_API_KEY=${var.domain_api_key}",
    # Traces + metrics only -- logs flow via alloy's docker-socket
    # scrape of this container's stdout.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=transacional-api",
    "PORT=8012",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8012
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
