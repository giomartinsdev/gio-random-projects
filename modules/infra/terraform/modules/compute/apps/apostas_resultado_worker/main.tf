# apostas-resultado-worker: a background sweep, not an HTTP service --
# no published port, no ingress route, no hostname. It reads every
# pending aposta from domain-api (GET /apostas/pendentes), reasons
# about each one with the 9router text model (extract the event, then
# judge it against a real placar from sportsdata), and publishes
# aposta.resolver + transacao.create via /sync for anything it can
# resolve with high confidence. No database of its own, same as every
# other financas backend.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "apostas_resultado_worker" {
  name    = "apostas-resultado-worker"
  image   = "${var.registry_host}/apostas-resultado-worker:latest"
  restart = "unless-stopped"

  env = [
    "APOSTAS_RESULTADO_WORKER_DOMAIN_API_URL=${var.domain_api_url}",
    "APOSTAS_RESULTADO_WORKER_DOMAIN_API_KEY=${var.domain_api_key}",
    "APOSTAS_RESULTADO_WORKER_POLL_INTERVAL_SECONDS=${var.poll_interval_seconds}",
    "APOSTAS_RESULTADO_WORKER_AI_BASE_URL=${var.ai_base_url}",
    "APOSTAS_RESULTADO_WORKER_AI_API_KEY=${var.ai_api_key}",
    "APOSTAS_RESULTADO_WORKER_AI_MODEL=${var.ai_model}",
    "APOSTAS_RESULTADO_WORKER_SPORTSDATA_BASE_URL=${var.sportsdata_base_url}",
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
