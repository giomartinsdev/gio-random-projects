# Static SPA, nginx-served (see modules/apps/buteco-class-frontend's
# Dockerfile) -- VITE_POST_API_URL is baked into the bundle at BUILD
# time (ts-frontend-ci-cd.yml's build-args), not something this
# container's env can override at runtime.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "buteco_class_frontend" {
  name    = "buteco-class-frontend"
  image   = "${var.registry_host}/buteco-class-frontend:latest"
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
