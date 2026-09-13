# proventos-worker: a background sweep, not an HTTP service -- no
# published port, no ingress route, no hostname. It reads every open
# ativo position from domain-api (GET /ativos/todos), checks
# fundamentus.com.br for dividend events, and publishes
# ativo.registerMovement + transacao.create via /sync for anything new.
# No database of its own, same as every other financas backend.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "proventos_worker" {
  name    = "proventos-worker"
  image   = "${var.registry_host}/proventos-worker:latest"
  restart = "unless-stopped"

  env = [
    "PROVENTOS_WORKER_DOMAIN_API_URL=${var.domain_api_url}",
    "PROVENTOS_WORKER_DOMAIN_API_KEY=${var.domain_api_key}",
    "PROVENTOS_WORKER_POLL_INTERVAL_SECONDS=${var.poll_interval_seconds}",
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
