# CI's own image registry, plus the pull-based redeploy mechanism that
# watches it. Neither depends on compute/data or compute/app — this is
# the deploy pipeline, not the app itself.

resource "docker_volume" "registry_data" {
  # Same name the pre-Terraform compose stack used — keeps the actual
  # pushed image blobs across the cutover instead of starting empty.
  name = "registry_registry-data"

  # The imported volume carries com.docker.compose.* labels from its
  # compose-managed past. labels is an immutable (ForceNew) attribute,
  # so without this, the mere absence of those labels from this
  # resource's config would destroy and recreate the volume on first
  # apply — losing exactly the data importing it was meant to keep.
  lifecycle {
    ignore_changes = [labels]
  }
}

resource "docker_volume" "registry_auth" {
  name = "registry_registry-auth"

  lifecycle {
    ignore_changes = [labels]
  }
}

# One-shot: bcrypts registry_password into the htpasswd file the
# registry container reads. registry:2's image has no htpasswd tool of
# its own; httpd:2.4-alpine (Apache) does via apache2-utils.
# must_run = false + attach = true makes Terraform run this to
# completion (like `docker run`, not `docker run -d`) instead of
# expecting a long-lived process.
resource "docker_container" "htpasswd_init" {
  name       = "htpasswd-init"
  image      = "httpd:${var.htpasswd_init_version}"
  entrypoint = ["sh", "-c"]
  command = [
    "htpasswd -Bbn \"$REGISTRY_USER\" \"$REGISTRY_PASSWORD\" > /auth/htpasswd"
  ]
  must_run = false
  attach   = true

  env = [
    "REGISTRY_USER=${var.registry_user}",
    "REGISTRY_PASSWORD=${var.registry_password}",
  ]

  mounts {
    type   = "volume"
    source = docker_volume.registry_auth.name
    target = "/auth"
  }
}

# Writes gio-server's own `docker login registry.giomartins.dev`
# credentials file -- watchtower's pulls (and any docker_container
# resource here, if ever recreated) need this, and it used to be a
# manual `docker login` run by hand on the host. Same bind-mount
# one-shot pattern as registry_client_cert_install below. Whole-file
# overwrite is safe here: this host has never logged into any registry
# other than this one.
resource "docker_container" "docker_config_install" {
  name       = "registry-docker-config-install"
  image      = "alpine:3"
  entrypoint = ["sh", "-c"]
  command = [
    "mkdir -p /dockerconfig && printf '{\"auths\":{\"registry.giomartins.dev\":{\"auth\":\"%s\"}}}' \"$REGISTRY_AUTH_B64\" > /dockerconfig/config.json"
  ]
  must_run = false
  attach   = true

  env = [
    "REGISTRY_AUTH_B64=${base64encode("${var.registry_user}:${var.registry_password}")}",
  ]

  mounts {
    type   = "bind"
    source = "/root/.docker"
    target = "/dockerconfig"
  }

  depends_on = [docker_container.htpasswd_init]
}

resource "docker_container" "registry" {
  name    = "registry"
  image   = "registry:${var.registry_version}"
  restart = "unless-stopped"

  depends_on = [docker_container.htpasswd_init]

  env = [
    "REGISTRY_STORAGE_DELETE_ENABLED=true",
    # No auth by default is a real bug, not a "keep it internal" design
    # choice — an unauthenticated `docker push` against a plain
    # registry:2 succeeds. Basic auth via htpasswd is the officially
    # documented way to lock down a single-node registry without a
    # separate auth service.
    "REGISTRY_AUTH=htpasswd",
    "REGISTRY_AUTH_HTPASSWD_REALM=Registry Realm",
    "REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd",
    # Without this, blob-upload responses embed an ABSOLUTE Location
    # URL built from whatever Host header the registry saw — which
    # escapes any reverse proxy in front of it (Cloudflare Tunnel/
    # Access here). The client follows that Location directly on the
    # next request, bypassing the proxy (and whatever auth it
    # injected) entirely. Relative URLs resolve against the original
    # request's host instead, so every follow-up stays on the same
    # path in.
    "REGISTRY_HTTP_RELATIVEURLS=true",
  ]

  ports {
    internal = 5000
    external = 5000
  }

  mounts {
    type   = "volume"
    source = docker_volume.registry_data.name
    target = "/var/lib/registry"
  }

  mounts {
    type      = "volume"
    source    = docker_volume.registry_auth.name
    target    = "/auth"
    read_only = true
  }
}

# The pull-based half of apps-deploy.yml's CD: polls the registry above
# and redeploys any running container labeled
# com.centurylinklabs.watchtower.enable=true (compute/app's api/worker,
# when watchtower_enabled = true there) — no inbound access to
# gio-server required, unlike a push-based deploy would need.
resource "docker_container" "watchtower" {
  name    = "watchtower"
  image   = "containrrr/watchtower:latest"
  restart = "unless-stopped"

  env = [
    "WATCHTOWER_CLEANUP=true",
    "WATCHTOWER_LABEL_ENABLE=true",
    "WATCHTOWER_POLL_INTERVAL=${var.watchtower_poll_interval}",
    "DOCKER_API_VERSION=${var.watchtower_docker_api_version}",
  ]

  mounts {
    type   = "bind"
    source = "/var/run/docker.sock"
    target = "/var/run/docker.sock"
  }

  # `docker login registry.giomartins.dev` must already have been run
  # on the host with var.registry_user/registry_password — Terraform
  # has no way to populate this file itself, and it's what lets
  # watchtower pull from an authenticated registry. See README.
  mounts {
    type      = "bind"
    source    = "/root/.docker/config.json"
    target    = "/config.json"
    read_only = true
  }

  depends_on = [docker_container.registry_client_cert_install]
}

# One-shot: writes the mTLS client cert/key (module.cloudflare's
# registry_mtls.tf) into dockerd's own per-registry cert directory on
# gio-server — the exact path dockerd checks automatically for ANY
# connection it makes to registry.giomartins.dev, covering watchtower's
# pulls above and this module's own docker_container.registry
# resource if it's ever recreated, with no separate manual step.
resource "docker_container" "registry_client_cert_install" {
  name       = "registry-client-cert-install"
  image      = "alpine:3"
  entrypoint = ["sh", "-c"]
  command = [
    "mkdir -p /certs && printf '%s' \"$CLIENT_CERT\" > /certs/client.cert && printf '%s' \"$CLIENT_KEY\" > /certs/client.key"
  ]
  must_run = false
  attach   = true

  env = [
    "CLIENT_CERT=${var.registry_client_cert_pem}",
    "CLIENT_KEY=${var.registry_client_key_pem}",
  ]

  mounts {
    type   = "bind"
    source = "/etc/docker/certs.d/registry.giomartins.dev"
    target = "/certs"
  }
}
