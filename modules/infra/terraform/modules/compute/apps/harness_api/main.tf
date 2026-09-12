# harness-api: the corporate handoff harness's backend (Go + stdlib mux
# + pure-Go SQLite -- see modules/apps/harness-api's own README). Auth
# is Cloudflare Access on the public hostname's /api path: the edge
# injects Cf-Access-Jwt-Assertion and the app verifies the JWT itself
# (internal/httpapi/auth.go), the bet-api pattern -- so unlike bet-api
# there is no shared Postgres here, the state is SQLite on a docker
# volume and nothing on the apps network is a runtime dependency. The
# published loopback port is what ingress routes
# harness-api.giomartins.dev to (locals.tf's services).
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

# The SQLite database file (HARNESS_DB_PATH defaults to /data/harness.db)
# lives here so a redeploy keeps the sessions and their timelines. Same
# reasoning as cch-state.
resource "docker_volume" "harness_data" {
  name = "harness-data"
}

resource "docker_container" "harness_api" {
  name    = "harness-api"
  image   = "${var.registry_host}/harness-api:latest"
  restart = "unless-stopped"

  env = [
    # Access JWT validation (internal/httpapi/auth.go): the issuer every
    # Access JWT must carry (the app fetches the team's JWKS from
    # <issuer>/cdn-cgi/access/certs) and the audience tag of this app's
    # Access application (/api, login hop included) -- a token minted
    # for any OTHER Access app is rejected here.
    "HARNESS_ACCESS_ISSUER=https://${var.access_team_domain}",
    "HARNESS_ACCESS_AUD=${join(",", var.access_aud)}",
    # Defense-in-depth email allowlist checked after the JWT verifies
    # (the edge's Google-SSO policy already enforces the same list).
    "HARNESS_ALLOWED_EMAILS=${join(",", var.allowed_emails)}",
    # Cross-origin caller (the harness SPA's MinIO-served origin) -- the
    # CORS allowlist and /api/sso's return-parameter allowlist, plus
    # localhost dev like bet-api's.
    "HARNESS_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    "PORT=8010",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8010
    external = var.external_port
  }

  networks_advanced {
    name = var.network_name
  }

  volumes {
    volume_name    = docker_volume.harness_data.name
    container_path = "/data"
  }

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}