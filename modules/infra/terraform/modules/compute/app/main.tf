# The stateless half of the apps stack — api and worker. Depends on
# module.compute_data (network_name/postgres_host/redis_host) but never
# the other way around; see that module's own README.
locals {
  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"

  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "api" {
  name    = "api"
  image   = "${var.registry_host}/api:latest"
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=${local.database_url}",
    "REDIS_ADDR=${var.redis_host}:6379",
    "HTTP_ADDR=:8000",
    "DOMAIN_API_KEYS=${var.domain_api_keys}",
    "RATE_LIMIT_RPS=${var.rate_limit_rps}",
    "RATE_LIMIT_BURST=${var.rate_limit_burst}",
  ]

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

resource "docker_container" "worker" {
  name    = "worker"
  image   = "${var.registry_host}/worker:latest"
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=${local.database_url}",
    "REDIS_ADDR=${var.redis_host}:6379",
  ]

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
