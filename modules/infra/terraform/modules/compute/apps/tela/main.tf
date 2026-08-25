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

resource "docker_container" "tela" {
  name    = "tela"
  image   = "${var.registry_host}/tela:latest"
  restart = "unless-stopped"

  env = [
    "PORT=8000",
  ]

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
