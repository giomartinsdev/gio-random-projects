# Beszel: a hub (dashboard + SQLite storage) and an agent (collects
# host/container stats, reachable only by the hub — it never listens
# for anything else). Both run on the VPS since there's only one host
# to monitor; the hub connects to the agent over the shared docker
# network below, not the public internet.

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

  # Published straight on the host — reached directly as
  # beszel.giomartins.dev:8090 (grey-cloud record → server_ip) or
  # http://server_ip:8090, and later through Cloudflare once the
  # records flip proxied. There used to be an intermediate
  # beszel-proxy container in this path working around a
  # Cloudflare-Tunnel HTTP/2 quirk; the tunnel is gone and the proxy
  # with it. PocketBase (Beszel's own base) is happy with a plain
  # HTTP/1.1 origin.
  ports {
    internal = 8090
    external = 8090
  }

  mounts {
    type   = "volume"
    source = docker_volume.beszel_data.name
    target = "/beszel_data"
  }
}

resource "docker_container" "beszel_agent" {
  # The agent refuses to even start without a real KEY (crash-loops
  # immediately otherwise) — and that key doesn't exist until the hub
  # above has booted once and you've added this system through its UI
  # (see README.md). count keeps this resource absent entirely rather
  # than crash-looping until then; set agent_key and re-apply once you
  # have it.
  count = var.agent_key != "" ? 1 : 0

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
