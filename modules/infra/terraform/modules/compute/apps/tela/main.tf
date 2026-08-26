# tela: standalone screen sharing at tela.giomartins.dev. Deliberately
# shares nothing with the other apps here -- no Postgres, no Better
# Auth, no domain-api. A room is a code and a password held in the
# process's memory, so this container has no state worth persisting and
# a restart simply ends whatever was being shared.
#
# One container serves both the API and the React bundle (see
# modules/apps/tela/Dockerfile), which is why there's no separate
# front/api split like classroom-bdd + classroom-api.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_volume" "tela_state" {
  name = "tela-state"
}

resource "docker_container" "tela" {
  name    = "tela"
  image   = "${var.registry_host}/tela:latest"
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
  ]

  # Rooms live in memory, but the room registry itself (code, password
  # hash, resume key -- never the connected peers) is written here so a
  # redeploy doesn't end sessions that are in progress. Without it, a
  # deploy while people are sharing drops every room and they can't even
  # rejoin. See modules/apps/tela/internal/rooms/store.go.
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
