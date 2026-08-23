# Beszel: a hub (dashboard + SQLite storage) and an agent (collects
# host/container stats, reachable only by the hub — it never listens
# for anything else). Both run on gio-server since there's only one
# host to monitor; the hub connects to the agent over the shared
# docker network below, not the public internet.

resource "docker_volume" "beszel_data" {
  name = "beszel_data"
}

resource "docker_container" "beszel_hub" {
  name    = "beszel-hub"
  image   = "henrygd/beszel:${var.hub_image_tag}"
  restart = "unless-stopped"

  networks_advanced {
    name = var.network_name
  }

  # 127.0.0.1 only — reached through the Cloudflare Tunnel (see
  # locals.tf's ingress_rules), never meant to be LAN- or
  # internet-reachable directly.
  ports {
    internal = 8090
    external = 8090
    ip       = "127.0.0.1"
  }

  mounts {
    type   = "volume"
    source = docker_volume.beszel_data.name
    target = "/beszel_data"
  }
}

resource "docker_container" "beszel_agent" {
  name    = "beszel-agent"
  image   = "henrygd/beszel-agent:${var.agent_image_tag}"
  restart = "unless-stopped"

  networks_advanced {
    name = var.network_name
  }

  env = [
    "LISTEN=45876",
    "KEY=${var.agent_key}",
  ]

  # Per-container CPU/memory stats come from talking to the Docker API
  # directly — this is the only way the agent sees any container but
  # itself.
  mounts {
    type   = "bind"
    source = "/var/run/docker.sock"
    target = "/var/run/docker.sock"
  }
}
