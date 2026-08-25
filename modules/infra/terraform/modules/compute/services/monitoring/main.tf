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
  # beszel-proxy (modules/infra/terraform-bootstrap, not here — see
  # that module's README for why: building beszel-proxy's image needs
  # a docker_image + build{} resource, and that consistently fails
  # ("no active session ... context deadline exceeded") when applied
  # through this config's own CI proxy chain. Confirmed live: the
  # exact same resource, applied through terraform-bootstrap's direct
  # SSH-tunneled connection instead, builds fine — BuildKit's build
  # protocol needs a real bidirectional session the intermediary
  # proxies (nginx sidecar, docker-api-proxy) were never designed to
  # relay, unlike the plain request/response traffic every other
  # docker_container/docker_image (no build{}) resource in this repo
  # sends). Publishing this directly used to work for most calls, but
  # not for POST /api/collections/users/auth-refresh — see that
  # proxy's own comment.
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
