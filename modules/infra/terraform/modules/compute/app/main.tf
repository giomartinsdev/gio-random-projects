# The stateless half of the apps stack — api and worker. Depends on
# module.compute_data (network_name/postgres_host/redis_host) but never
# the other way around; see that module's own README.
locals {
  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"

  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  # Only set when the bridge actually exists (var.secrets_bridge_url
  # empty until modules/compute/vaultwarden_bridge is — see its own
  # README for why that can't have a real default). DATABASE_URL/
  # DOMAIN_API_KEYS above stay set regardless, as a fallback the app's
  # own config.Load() only uses when these two are absent — see
  # modules/apps/domain-api's internal/infrastructure/config.
  secrets_bridge_env = var.secrets_bridge_url == "" ? [] : [
    "SECRETS_BRIDGE_URL=${var.secrets_bridge_url}",
    "SECRETS_BRIDGE_API_KEY=${var.secrets_bridge_api_key}",
  ]
}

resource "docker_container" "domain_api" {
  name  = "domain-api"
  # Deliberately a stable literal, not a variable — a version that
  # changed per-deploy (the first attempt at this) meant any apply
  # that DIDN'T pass that override (every routine tf-deploy.yml run)
  # silently reverted it back to a default, flip-flopping against
  # whatever apps-deploy.yml had just pinned. Since this string never
  # changes, tf-deploy.yml's applies never touch it. apps-deploy.yml
  # instead forces the actual redeploy with `terraform apply
  # -replace=module.compute_app.docker_container.domain_api`, which
  # re-pulls and recreates unconditionally, picking up whatever
  # currently sits at :latest.
  image   = "${var.registry_host}/domain-api:latest"
  restart = "unless-stopped"

  env = concat([
    "DATABASE_URL=${local.database_url}",
    "REDIS_ADDR=${var.redis_host}:6379",
    "HTTP_ADDR=:8000",
    "DOMAIN_API_KEYS=${var.domain_api_keys}",
    "RATE_LIMIT_RPS=${var.rate_limit_rps}",
    "RATE_LIMIT_BURST=${var.rate_limit_burst}",
  ], local.secrets_bridge_env)

  ports {
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
