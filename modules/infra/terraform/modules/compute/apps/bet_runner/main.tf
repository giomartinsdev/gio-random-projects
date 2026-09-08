# bet-runner: the headless-Chrome worker that places the bets. No
# published ports, no public hostname, NO database connection: it polls
# bet-api's /internal/* over the apps network (same shape as the deals
# scrapers -- nothing calls in, it calls out). One bet at a time.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

# Persistent browser profiles: the bookmaker login (cookies/localStorage)
# survives here between runs, so login is the exception, not the rule.
# Wiping the volume just means the next bet does a fresh login.
resource "docker_volume" "bet_runner_profiles" {
  name = var.profiles_volume
}

resource "docker_container" "bet_runner" {
  name    = "bet-runner"
  image   = "${var.registry_host}/bet-runner:latest"
  restart = "unless-stopped"

  env = [
    "BET_API_URL=${var.bet_api_url}",
    "RUNNER_API_KEY=${var.runner_api_key}",
    "PROFILES_DIR=/data/profiles",
    # The one switch between rehearsal and real money (see the
    # variable's description -- true means never clicking confirm).
    "DRY_RUN=${var.dry_run ? "1" : "0"}",
    "POLL_INTERVAL_MS=${var.poll_interval_ms}",
    "BET_TIMEOUT_MS=${var.bet_timeout_ms}",
    # Traces + metrics only — logs flow via alloy's docker-socket scrape
    # of this container's stdout JSON.
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=bet-runner",
  ]

  volumes {
    volume_name    = docker_volume.bet_runner_profiles.name
    container_path = "/data"
  }

  # Chromium's demands: real memory headroom and /dev/shm (the default
  # 64MB kills tab rendering under load -- see shm_size's description).
  memory   = var.memory
  shm_size = var.shm_size

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
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