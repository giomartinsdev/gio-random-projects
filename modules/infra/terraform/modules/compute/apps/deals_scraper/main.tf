# deals-scraper: headless python poller -- one container per source
# (the module is instantiated once per source, see root main.tf).
# No published ports, no public hostname, NO database connection: deals
# are pushed through domain-api's POST /deals (command pipeline -> the
# Go worker writes raw_deals and emits deal.created; the separate
# events-announcer worker announces). An announce-sidecar used to live
# in this container; announcing now happens in events-announcer.

locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "scraper" {
  name    = var.app_name
  image   = "${var.registry_host}/${var.app_name}:latest"
  restart = "unless-stopped"

  env = [
    "DOMAIN_API_URL=${var.domain_api_url}",
    # domain-api's own API-key list comes from secrets.tf's
    # random_id.deals_domain_key (the ":deals-scrapers" entry) -- this
    # key never touches Vaultwarden, it's generated and wired here.
    "DOMAIN_API_KEY=${var.domain_api_key}",
    # The source's feed base URL -- a vault item, injected by CI as
    # TF_VAR_* at apply time; the repo ships no scraped-site hostnames
    # (see the scraper's client.py).
    "SOURCE_BASE_URL=${var.source_base_url}",
    # Challenge workaround: when the source's edge turns on a Cloudflare
    # challenge, the fetch layer hands the URL to FlareSolverr (the
    # module in root main.tf) and reuses its clearance. Empty = the
    # challenge code path never activates.
    "FLARESOLVERR_URL=${var.flaresolverr_url}",
    "POLL_SECONDS=${var.poll_seconds}",
    # Traces + metrics only — logs flow via alloy's docker-socket scrape
    # of this container's stdout JSON.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=${var.app_name}",
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