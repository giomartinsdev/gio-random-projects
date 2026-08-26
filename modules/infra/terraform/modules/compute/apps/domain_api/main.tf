# The stateless half of the apps stack — api and worker. Depends on
# module.compute_data (network_name/postgres_host/redis_host) but never
# the other way around; see that module's own README.
locals {
  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"

  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  # Was conditionally set whenever the bridge exists, for both
  # containers below to read as a fallback source ahead of their own
  # DATABASE_URL/DOMAIN_API_KEYS env vars. Neither container gets it
  # now -- see the TEMPORARY comment on docker_container.domain_api,
  # which now also applies to domain_worker: config.Load()'s resolve()
  # treats the bridge's 404 (item not found -- confirmed itself, not
  # domain_worker's own DATABASE_URL, went missing after a VPS
  # migration reset Vaultwarden's data) as fatal instead of falling
  # through to the env var, so setting these at all was actively
  # breaking domain_worker rather than backing it up.
  secrets_bridge_env = []
}

resource "docker_container" "domain_api" {
  name = "domain-api"
  # Deliberately a stable literal, not a variable — a version that
  # changed per-deploy (the first attempt at this) meant any apply
  # that DIDN'T pass that override (every routine go-ci-cd.yml run)
  # silently reverted it back to a default, flip-flopping against
  # whatever go-ci-cd.yml had just pinned. Since this string never
  # changes, go-ci-cd.yml's applies never touch it. go-ci-cd.yml
  # instead forces the actual redeploy with `terraform apply
  # -replace=module.compute_app.docker_container.domain_api`, which
  # re-pulls and recreates unconditionally, picking up whatever
  # currently sits at :latest.
  image   = "${var.registry_host}/domain-api:latest"
  restart = "unless-stopped"

  # TEMPORARY: neither this container nor domain_worker below gets
  # local.secrets_bridge_env (now always []) -- investigating
  # DOMAIN_API_KEYS/DATABASE_URL never showing up via the bridge's own
  # GET /secret/... despite the Vaultwarden item itself being
  # re-seeded from scratch (state rm + fresh create, or a whole fresh
  # Vaultwarden instance after the VPS migration) and the bridge
  # container restarted after that. Forces config.Load()'s resolve()
  # onto its env-var fallback instead, which IS provably current (both
  # are computed from the exact same locals the vault_seed items use).
  # Revert once the vault-side staleness is understood -- see incident
  # notes to add once resolved.
  env = [
    "DATABASE_URL=${local.database_url}",
    "REDIS_ADDR=${var.redis_host}:6379",
    "HTTP_ADDR=:8000",
    "DOMAIN_API_KEYS=${var.domain_api_keys}",
    "RATE_LIMIT_RPS=${var.rate_limit_rps}",
    "RATE_LIMIT_BURST=${var.rate_limit_burst}",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8000
    external = 8000
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

resource "docker_container" "domain_worker" {
  name = "domain-worker"
  # See domain_api's own comment above — same reasoning.
  image   = "${var.registry_host}/domain-worker:latest"
  restart = "unless-stopped"

  env = concat([
    "DATABASE_URL=${local.database_url}",
    "REDIS_ADDR=${var.redis_host}:6379",
  ], local.secrets_bridge_env)

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
