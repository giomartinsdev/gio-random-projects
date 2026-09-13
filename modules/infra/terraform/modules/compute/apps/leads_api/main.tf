# leads-api: the one PUBLIC, un-gated backend in the financas feature --
# it exists purely so an anonymous visitor on financas-frontend's
# landing page can submit an e-mail before ever authenticating. No
# Cloudflare Access application at all (see its hostname's entry in
# root variables.tf's excluded_hostnames), no database of its own --
# persistence rides domain-api's shared Postgres via the command
# pipeline, same as every other financas backend.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_container" "leads_api" {
  name    = "leads-api"
  image   = "${var.registry_host}/leads-api:latest"
  restart = "unless-stopped"

  env = [
    "LEADS_FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    "LEADS_DOMAIN_API_URL=${var.domain_api_url}",
    "LEADS_DOMAIN_API_KEY=${var.domain_api_key}",
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=leads-api",
    "PORT=8015",
  ]

  ports {
    ip       = "127.0.0.1"
    internal = 8015
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
