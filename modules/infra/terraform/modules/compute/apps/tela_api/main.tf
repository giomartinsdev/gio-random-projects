# tela-api: the signalling/SFU backend for tela-frontend
# (tela.giomartins.dev). Split from it (this container used to serve
# both the API and the React bundle) so each can deploy independently
# and scale/restart on its own schedule -- tela-frontend is a static
# nginx container with none of tela-api's host-networking/SFU needs.
# Neither app shares anything with the rest of this repo -- no
# Postgres, no Better Auth, no domain-api.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_volume" "tela_state" {
  name = "tela-state"
}

resource "docker_container" "tela_api" {
  name    = "tela-api"
  image   = "${var.registry_host}/tela-api:latest"
  restart = "unless-stopped"

  # Host networking, unlike every other app here. The SFU has to
  # advertise an address browsers can reach, and inside a bridge network
  # the only address it can see is the container's private one -- which
  # would need the real address pasted into a variable to work around.
  # On the host network it sees the machine's actual interfaces and
  # advertises the VPS's public IP by itself.
  #
  # The cost is isolation: the container shares the host's network
  # namespace. That also means no port mapping -- the app binds
  # var.external_port directly (the HTTP side), and the UDP port binds
  # unmapped (it must, since its number is baked into the ICE
  # candidates the SFU advertises).
  network_mode = "host"

  env = [
    "PORT=${var.external_port}",
    # The ingress (compute/services/ingress) is the only thing meant to
    # reach the HTTP side directly -- it runs on the host network too
    # and proxies by Host header to 127.0.0.1:${var.external_port}.
    # The UDP media port below is unaffected: it has to stay reachable
    # from the internet directly, since it's WebRTC media, not HTTP.
    "BIND_HOST=127.0.0.1",
    "STATE_FILE=/data/rooms.json",
    # The SFU is a WebRTC endpoint, so browsers connect to it directly
    # over UDP -- plain HTTP proxies don't carry media. This is the
    # address it advertises, and inside Docker it has to be the HOST's,
    # not the container's. On the VPS that's simply its static public
    # IP (var.server_ip) -- no DNS indirection needed anymore, the old
    # home-setup media hostname was for an address that changed without
    # warning.
    "SFU_PUBLIC_HOST=${var.sfu_public_host}",
    "SFU_UDP_PORT=${var.sfu_udp_port}",
    # Now a cross-origin caller (tela-frontend's own hostname/container)
    # instead of same-origin -- see internal/httpapi's AllowedOrigins.
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Loopback, not http://alloy:4318: host networking means docker DNS
    # doesn't exist here -- alloy's 4318 is published on 127.0.0.1 for
    # ingress, and this container shares the host's loopback. Traces +
    # metrics only -- logs flow via alloy's docker-socket scrape of
    # stdout (see otlp_endpoint's description).
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=tela-api",
  ]

  # Rooms live in memory, but the room registry itself (code, password
  # hash, resume key -- never the connected peers) is written here so a
  # redeploy doesn't end sessions that are in progress. Without it, a
  # deploy while people are sharing drops every room and they can't even
  # rejoin. See modules/apps/tela-api/internal/rooms/store.go.
  volumes {
    volume_name    = docker_volume.tela_state.name
    container_path = "/data"
  }

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}
