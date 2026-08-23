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
# docstring for the exact upstream bug this works around. Built from
# the same Dockerfile modules/infra/docker-api-proxy/compose.yaml used
# to `build: .` — this resource just does that build against whatever
# daemon var.docker_host points at instead.
resource "docker_image" "docker_api_proxy" {
  name = "docker-api-proxy:latest"
  build {
    context = "${path.module}/../docker-api-proxy"
  }
  # docker_image only rebuilds when this map's values change — without
  # it, editing proxy.py wouldn't trigger a rebuild at all, since
  # nothing else about this resource's config would differ.
  triggers = {
    dockerfile_sha1 = filesha1("${path.module}/../docker-api-proxy/Dockerfile")
    proxy_py_sha1   = filesha1("${path.module}/../docker-api-proxy/proxy.py")
  }
}

resource "docker_container" "docker_api_proxy" {
  name    = "docker-api-proxy"
  image   = docker_image.docker_api_proxy.image_id
  restart = "unless-stopped"

  # host networking — so 127.0.0.1:2376 inside the container actually
  # reaches dockerd's TCP listener on gio-server itself, same reasoning
  # infra/cloudflared's own container uses.
  network_mode = "host"
}
