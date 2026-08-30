# deals-scraper: headless python poller -- one container per source
# (the module is instantiated once per source, see root main.tf).
# Deliberately leaner than the API app modules: no published ports, no
# public hostname, no OTEL telemetry, and no migrate sidecar --
# deals_common.db self-migrates raw_deals on boot. It only writes the
# shared Postgres and (optionally) announces INSERTED deals on Discord.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []

  database_url = "postgresql://${var.postgres_user}:${var.postgres_password}@${var.postgres_host}:5432/${var.postgres_user}"
}

resource "docker_container" "scraper" {
  name    = var.app_name
  image   = "${var.registry_host}/${var.app_name}:latest"
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=${local.database_url}",
    # The source's feed base URL -- a vault item, injected by CI as
    # TF_VAR_* at apply time; the repo ships no scraped-site hostnames
    # (see the scraper's client.py).
    "SOURCE_BASE_URL=${var.source_base_url}",
    # Blank webhook = silent collection (announce disabled).
    "DISCORD_DEALS_WEBHOOK_URL=${var.discord_webhook_url}",
    "POLL_SECONDS=${var.poll_seconds}",
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