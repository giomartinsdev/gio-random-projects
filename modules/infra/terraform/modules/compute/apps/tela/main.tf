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

  env = [
    "PORT=8000",
    "STATE_FILE=/data/rooms.json",
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

  ports {
    internal = 8000
    external = var.external_port
  }

  networks_advanced {
    name = var.network_name
  }

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}
