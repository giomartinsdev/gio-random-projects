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

  # No published port — only reachable over the docker network, by
  # beszel_proxy below (which the tunnel actually points at). Publishing
  # this directly used to work for most calls, but not for
  # POST /api/collections/users/auth-refresh — see beszel_proxy's own
  # comment.
  mounts {
    type   = "volume"
    source = docker_volume.beszel_data.name
    target = "/beszel_data"
  }
}

# Sits between beszel.giomartins.dev (cloudflared) and beszel-hub — see
# beszel-proxy/proxy.py's own module docstring for the exact Cloudflare
# Tunnel quirk this works around (the same root cause as
# modules/infra/terraform-bootstrap/docker-api-proxy, different
# symptom).
resource "docker_image" "beszel_proxy" {
  name = "beszel-proxy:latest"
  build {
    context = "${path.module}/beszel-proxy"
  }
  triggers = {
    dockerfile_sha1 = filesha1("${path.module}/beszel-proxy/Dockerfile")
    proxy_py_sha1   = filesha1("${path.module}/beszel-proxy/proxy.py")
  }
}

resource "docker_container" "beszel_proxy" {
  name    = "beszel-proxy"
  image   = docker_image.beszel_proxy.image_id
  restart = "unless-stopped"

  networks_advanced {
    name = var.network_name
  }

  # 127.0.0.1 only — reached through the Cloudflare Tunnel (see
  # locals.tf's ingress_rules), never meant to be LAN- or
  # internet-reachable directly.
  ports {
    internal = 8091
    external = 8090
    ip       = "127.0.0.1"
  }

  depends_on = [docker_container.beszel_hub]
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
