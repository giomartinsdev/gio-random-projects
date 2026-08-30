# events-announcer: the durable reader of domain.events.queue (the
# list domain-worker RPUSHes before publishing each event) — posts
# fresh deals to a Discord webhook. No published ports, no database:
# its only storage is the Redis list it consumes, and a blank
# DEALS_DISCORD_WEBHOOK_URL keeps the queue draining with announcing
# off (see the app README).

locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "announcer" {
  name    = var.app_name
  image   = "${var.registry_host}/${var.app_name}:latest"
  restart = "unless-stopped"

  env = [
    "REDIS_ADDR=${var.redis_host}:6379",
    "DOMAIN_EVENTS_QUEUE=${var.domain_events_queue}",
    "ANNOUNCE_MAX_PER_FLUSH=${var.announce_max_per_flush}",
    "ANNOUNCE_MAX_AGE_HOURS=${var.announce_max_age_hours}",
    # One POST per deal, spread out; a burst of first-seen deals must
    # not trip Discord's rate limit.
    "ANNOUNCE_MIN_INTERVAL_S=${var.announce_min_interval_s}",
    "ANNOUNCE_MAX_REQUEUES=${var.announce_max_requeues}",
    # Blank webhook = announcing off: events are still drained and
    # counted (outcome="dry" on the announcements counter), never lost.
    "DEALS_DISCORD_WEBHOOK_URL=${var.discord_webhook_url}",
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