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
