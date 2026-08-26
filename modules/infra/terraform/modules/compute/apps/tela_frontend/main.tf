# Static SPA, nginx-served (see modules/apps/tela-frontend's
# Dockerfile) -- VITE_TELA_API_URL is baked into the bundle at BUILD
# time (ts-frontend-ci-cd.yml's build-args), not something this
# container's env can override at runtime. Plain bridge-networked app
# like every other frontend here -- unlike tela-api, this one has no
# host-networking/SFU need at all.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "tela_frontend" {
  name    = "tela-frontend"
  image   = "${var.registry_host}/tela-frontend:latest"
  restart = "unless-stopped"

  ports {
    ip       = "127.0.0.1"
    internal = 80
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
