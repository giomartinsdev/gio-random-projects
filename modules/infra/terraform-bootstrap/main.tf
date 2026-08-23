resource "cloudflare_r2_bucket" "tfstate" {
  account_id = var.cloudflare_account_id
  name       = "gio-homelab-tfstate"
  location   = "ENAM" # Eastern North America — closest region to Cloudflare's default edge for this account
}

# The S3 Access Key ID/Secret Access Key pair to actually read/write
# this bucket can't be created here — Cloudflare doesn't expose R2 API
# token/access-key generation through this provider (only bucket
# management). Create it once by hand: R2 → Manage API Tokens → Create
# API Token → Object Read & Write, scoped to this bucket. See
# modules/infra/terraform/README.md for what happens with it next.

# Remote-managed: no --config flag, so cloudflared fetches its ingress
# rules from Cloudflare's control plane instead of a local file — those
# rules are pushed by modules/infra/terraform/modules/cloudflare's
# cloudflare_zero_trust_tunnel_cloudflared_config resource, the actual
# source of truth for what this tunnel forwards where.
resource "docker_container" "cloudflared" {
  name    = "cloudflared"
  image   = "cloudflare/cloudflared:${var.cloudflared_image_tag}"
  restart = "unless-stopped"

  # host networking — cloudflared needs to reach dockerd and every
  # other locally-published service (registry, api, docker-api-proxy)
  # by localhost, the same reasoning docker-api-proxy's own container
  # uses.
  network_mode = "host"

  command = [
    "tunnel",
    "--credentials-file", "/etc/cloudflared/creds.json",
    "--protocol", "http2",
    "run", var.tunnel_id,
  ]

  mounts {
    type      = "bind"
    source    = var.creds_file_path
    target    = "/etc/cloudflared/creds.json"
    read_only = true
  }
}

# Sits between cloudflared (docker.giomartins.dev's ingress target) and
# the real dockerd — see docker-api-proxy/proxy.py's own module
# docstring for the exact upstream quirk this works around. Builds
# ./docker-api-proxy as the Docker build context.
resource "docker_image" "docker_api_proxy" {
  name = "docker-api-proxy:latest"
  build {
    context = "${path.module}/docker-api-proxy"
  }
  # docker_image only rebuilds when this map's values change — without
  # it, editing proxy.py wouldn't trigger a rebuild at all, since
  # nothing else about this resource's config would differ.
  triggers = {
    dockerfile_sha1 = filesha1("${path.module}/docker-api-proxy/Dockerfile")
    proxy_py_sha1   = filesha1("${path.module}/docker-api-proxy/proxy.py")
  }
}

resource "docker_container" "docker_api_proxy" {
  name    = "docker-api-proxy"
  image   = docker_image.docker_api_proxy.image_id
  restart = "unless-stopped"

  # host networking — so 127.0.0.1:2376 inside the container actually
  # reaches dockerd's TCP listener on gio-server itself, same reasoning
  # this file's cloudflared resource uses.
  network_mode = "host"
}

# Sits between beszel.giomartins.dev (cloudflared) and beszel-hub
# (modules/infra/terraform/modules/compute/monitoring, a different
# config entirely) — see beszel-proxy/proxy.py's own module docstring
# for the exact Cloudflare Tunnel quirk this works around. Lives here,
# not alongside beszel-hub itself, because building its image needs a
# docker_image + build{} resource, and that only works applied through
# this config's direct SSH-tunneled connection — see this directory's
# README for the full reasoning (the same one that keeps
# docker_api_proxy above here instead of in the main config).
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

  # Joins the compute/data module's "apps" network (by name, not a
  # cross-state reference — this config and the main one manage
  # separate state but the same real dockerd) so it can reach
  # beszel-hub by container name. NOT host networking, unlike
  # cloudflared/docker_api_proxy above: this one only needs to reach
  # one specific container, not the host's own loopback services.
  networks_advanced {
    name = var.beszel_network_name
  }

  # 127.0.0.1 only — reached through the Cloudflare Tunnel (see the
  # main config's locals.tf ingress_rules), never meant to be LAN- or
  # internet-reachable directly.
  ports {
    internal = 8091
    external = 8090
    ip       = "127.0.0.1"
  }
}
