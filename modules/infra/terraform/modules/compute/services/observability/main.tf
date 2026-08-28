# The Grafana observability stack: grafana (dashboards), loki (logs),
# prometheus (metrics), tempo (traces), and alloy (the single OTLP
# collector everything funnels through). One module, one concern — the
# same precedent as monitoring (beszel hub + agent) and registry
# (registry + watchtower): the pieces only exist to serve each other.
#
# Data flow:
#
#   apps (docker network)  ──OTLP http://alloy:4318──┐
#   browsers (SPAs)        ──OTLP otel.giomartins.dev─┤ (ingress → 127.0.0.1:4318)
#                                                    ▼
#                                     alloy ──traces──→ tempo
#                                           ──metrics──→ prometheus (remote-write receiver)
#   every container's stdout ──alloy (docker.sock)──→ loki
#
# Every container here stays on the shared docker network; only grafana
# (:3000) and alloy's browser-facing OTLP/HTTP (:4318) publish a port,
# and both loopback-only — ingress is the only way in from outside.
# grafana.giomartins.dev sits behind Cloudflare Access (same as beszel);
# otel.giomartins.dev is deliberately excluded (a public visitor's
# browser can't pass a Google SSO redirect — the receiver's CORS
# allowlist is the control; see root variables.tf's excluded_hostnames).
#
# Configs are written straight into each container at create time via
# `upload` — the same pattern as ingress's nginx conf: content depends
# only on module variables, so a config change recreates the container
# (data survives in the volumes) with no init container or
# restart-null_resource dance. `upload` is ForceNew for exactly this
# reason; see the ingress module's comment.

resource "docker_volume" "loki_data" {
  name = "obs_loki_data"
}

resource "docker_volume" "prom_data" {
  name = "obs_prom_data"
}

resource "docker_volume" "tempo_data" {
  name = "obs_tempo_data"
}

resource "docker_volume" "alloy_state" {
  # Alloy's own positions/state (where each scraped log stream left
  # off), not anyone's telemetry — losing it just re-reads a few recent
  # container logs on the next boot.
  name = "obs_alloy_state"
}

resource "docker_volume" "grafana_data" {
  name = "obs_grafana_data"
}

# The five containers run as root (user = "0"): a fresh docker volume
# is root:root 0755 and loki/tempo/grafana don't chown their data dirs
# on boot the way postgres's entrypoint does. Root-in-container behind
# loopback-only ports buys no network exposure; tighten with a chown
# pass if it ever matters. Alloy additionally needs root to read the
# host's docker.sock (same as beszel-agent and watchtower).
#
# memory = 512 on each is deliberate, unlike the rest of this repo's
# containers: this stack runs alongside postgres, redis, minio, five
# apps, AND a Project Zomboid server that doesn't share a cgroup with
# anyone. A memory ceiling that OOM-kills and restarts one observability
# container is preferable to it squeezing the game server; raise the
# ceiling if a container starts cycling (see README).

resource "docker_container" "loki" {
  name    = "loki"
  image   = "grafana/loki:${var.loki_image_tag}"
  restart = "unless-stopped"
  user    = "0"

  command = ["-config.file=/etc/loki/local-config.yaml"]

  # Written at create time; a config change recreates the container
  # (volumes keep the data — see the module header).
  upload {
    content = templatefile("${path.module}/templates/loki.yaml.tftpl", {})
    file    = "/etc/loki/local-config.yaml"
  }

  networks_advanced {
    name = var.network_name
  }

  memory = 512

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }

  mounts {
    type   = "volume"
    source = docker_volume.loki_data.name
    target = "/loki"
  }
}

resource "docker_container" "prometheus" {
  name    = "prometheus"
  image   = "prom/prometheus:${var.prometheus_image_tag}"
  restart = "unless-stopped"
  user    = "0"

  # Deliberate entrypoint (kreuzwerker resets it when `command` is set
  # otherwise) + --web.enable-remote-write-receiver: alloy's metrics
  # exporter pushes OTLP-converted samples to /api/v1/write — without
  # the flag Prometheus answers 404 and every app metric silently
  # disappears.
  entrypoint = ["/bin/prometheus"]
  command = [
    "--config.file=/etc/prometheus/prometheus.yml",
    "--storage.tsdb.path=/prometheus",
    "--storage.tsdb.retention.time=15d",
    "--web.enable-remote-write-receiver",
  ]

  upload {
    content = templatefile("${path.module}/templates/prometheus.yml.tftpl", {})
    file    = "/etc/prometheus/prometheus.yml"
  }

  networks_advanced {
    name = var.network_name
  }

  memory = 512

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }

  mounts {
    type   = "volume"
    source = docker_volume.prom_data.name
    target = "/prometheus"
  }
}

resource "docker_container" "tempo" {
  name    = "tempo"
  image   = "grafana/tempo:${var.tempo_image_tag}"
  restart = "unless-stopped"
  user    = "0"

  command = ["-config.file=/etc/tempo/tempo.yaml"]

  upload {
    content = templatefile("${path.module}/templates/tempo.yaml.tftpl", {})
    file    = "/etc/tempo/tempo.yaml"
  }

  networks_advanced {
    name = var.network_name
  }

  memory = 512

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }

  mounts {
    type   = "volume"
    source = docker_volume.tempo_data.name
    target = "/var/tempo"
  }
}

resource "docker_container" "alloy" {
  name    = "alloy"
  image   = "grafana/alloy:${var.alloy_image_tag}"
  restart = "unless-stopped"
  user    = "0"

  command = [
    "run",
    "--server.http.listen-addr=0.0.0.0:12345",
    "--storage.path=/var/lib/alloy/data",
    "/etc/alloy/config.alloy",
  ]

  upload {
    content = templatefile("${path.module}/templates/config.alloy.tftpl", {
      frontend_origins = var.frontend_origins
    })
    file = "/etc/alloy/config.alloy"
  }

  networks_advanced {
    name = var.network_name
  }

  # Loopback-only: this is the one observability port the outside world
  # reaches (the two SPAs' browsers, via otel.giomartins.dev through
  # ingress). In-docker apps talk to alloy:4317/4318 over the network
  # above and never touch this published port — and host-networked
  # tela-api reaches it over the host's loopback, which is the same
  # port.
  ports {
    ip       = "127.0.0.1"
    internal = 4318
    external = 4318
  }

  memory = 512

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }

  mounts {
    type   = "volume"
    source = docker_volume.alloy_state.name
    target = "/var/lib/alloy/data"
  }

  # Read-only in spirit: alloy only ever reads container log streams
  # and metadata through it — it never touches docker state. (The
  # docker provider has no read_only flag for bind mounts; the mount
  # itself is the same one beszel-agent and watchtower use.)
  mounts {
    type   = "bind"
    source = "/var/run/docker.sock"
    target = "/var/run/docker.sock"
  }

  # Backends first: alloy starts with nothing to export to otherwise
  # (it retries, but why start the pipeline before the sinks exist).
  depends_on = [docker_container.loki, docker_container.prometheus, docker_container.tempo]
}

resource "docker_container" "grafana" {
  name    = "grafana"
  image   = "grafana/grafana-oss:${var.grafana_image_tag}"
  restart = "unless-stopped"
  user    = "0"

  env = [
    "GF_SECURITY_ADMIN_PASSWORD=${var.grafana_admin_password}",
    "GF_SERVER_ROOT_URL=https://grafana.giomartins.dev",
    "GF_USERS_ALLOW_SIGN_UP=false",
    "GF_ANALYTICS_REPORTING_ENABLED=false",
  ]

  # Loopback-only: ingress proxies grafana.giomartins.dev here.
  ports {
    ip       = "127.0.0.1"
    internal = 3000
    external = 3000
  }

  memory = 512

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }

  # Provisioning files land in paths that already exist in the image —
  # upload can't mkdir. The dashboard JSON rides in the same directory
  # as its own provider yaml (that provider reads *.json only).
  upload {
    content = templatefile("${path.module}/templates/grafana-datasources.yaml.tftpl", {})
    file    = "/etc/grafana/provisioning/datasources/datasources.yaml"
  }

  upload {
    content = templatefile("${path.module}/templates/grafana-dashboards.yaml.tftpl", {})
    file    = "/etc/grafana/provisioning/dashboards/dashboards.yaml"
  }

  upload {
    content = templatefile("${path.module}/templates/apps-overview.json.tftpl", {})
    file    = "/etc/grafana/provisioning/dashboards/apps-overview.json"
  }

  mounts {
    type   = "volume"
    source = docker_volume.grafana_data.name
    target = "/var/lib/grafana"
  }

  depends_on = [docker_container.loki, docker_container.prometheus, docker_container.tempo]
}