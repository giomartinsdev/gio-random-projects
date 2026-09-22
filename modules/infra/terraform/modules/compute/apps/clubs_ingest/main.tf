# clubs-ingest: a background poller, not an HTTP service -- no published port, no
# ingress route, no hostname. It reads the clubs it follows from domain-api,
# fetches their data from the EA Pro Clubs source, and writes back through
# domain-api. No database of its own, same as every service in this repo.
#
# Python rather than Go because the source sits behind a CDN that blocks
# requests which do not look like a browser's; the vendored client already
# encodes what passes. See the app's own README and normalize.py.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "clubs_ingest" {
  name    = "clubs-ingest"
  image   = "${var.registry_host}/clubs-ingest:latest"
  restart = "unless-stopped"

  env = [
    "CLUBS_INGEST_DOMAIN_API_URL=${var.domain_api_url}",
    "CLUBS_INGEST_DOMAIN_API_KEY=${var.domain_api_key}",
    "CLUBS_INGEST_POLL_SECONDS=${var.poll_seconds}",
    "CLUBS_INGEST_TTL_MATCHES=${var.ttl_matches}",
    "CLUBS_INGEST_TTL_SQUAD=${var.ttl_squad}",
    "CLUBS_INGEST_DISCORD_WEBHOOK=${var.discord_webhook_url}",
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=clubs-ingest",
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
