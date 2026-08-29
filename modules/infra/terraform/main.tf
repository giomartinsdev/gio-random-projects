module "cloud_cloudflare" {
  source = "./modules/cloud/cloudflare"
  providers = {
    cloudflare = cloudflare
    tls        = tls
  }

  account_id                      = var.cloudflare_account_id
  zone_id                         = var.cloudflare_zone_id
  server_ip                       = var.server_ip
  google_idp_identity_provider_id = var.google_idp_identity_provider_id
  # static_sites' hostnames still need their own A record + Access
  # handling same as everything in services -- they're a different
  # ingress route (MinIO, not a container port), not a different DNS
  # or Access story.
  hostnames          = concat([for s in local.services : s.hostname], [for s in local.static_sites : s.hostname])
  excluded_hostnames = var.excluded_hostnames
  allowed_emails     = var.allowed_emails
  session_duration   = var.session_duration

  # Email Routing lives on the zone's DNS (MX/SPF/DKIM) plus account
  # state, not on any hostname's ingress — so it slots into this
  # module rather than into compute.
  email_routing_destination = var.email_routing_destination
  email_routing_rules       = var.email_routing_rules
}

module "network_docker_apps" {
  source = "./modules/network/docker_apps"
  providers = {
    docker = docker
  }

  network_name = "apps"
}

module "storage_postgres" {
  source = "./modules/storage/postgres"
  providers = {
    docker = docker
  }

  postgres_password = random_password.postgres.result
  network_name      = module.network_docker_apps.network_name
}

module "storage_redis" {
  source = "./modules/storage/redis"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
}

module "storage_minio" {
  source = "./modules/storage/minio"
  providers = {
    docker = docker
  }

  network_name  = module.network_docker_apps.network_name
  root_password = random_password.minio_root_password.result
}

module "compute_apps_domain_api" {
  source = "./modules/compute/apps/domain_api"
  providers = {
    docker = docker
  }

  network_name           = module.network_docker_apps.network_name
  postgres_host          = module.storage_postgres.postgres_host
  postgres_user          = module.storage_postgres.postgres_user
  postgres_password      = random_password.postgres.result
  redis_host             = module.storage_redis.redis_host
  registry_host          = var.registry_host
  domain_api_keys        = local.domain_api_keys
  secrets_bridge_url     = length(module.compute_services_vaultwarden_bridge) > 0 ? module.compute_services_vaultwarden_bridge[0].internal_url : ""
  secrets_bridge_api_key = random_password.vaultwarden_bridge_api_key.result
  otlp_endpoint          = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync]
}

module "compute_apps_post_api" {
  source = "./modules/compute/apps/post_api"
  providers = {
    docker = docker
  }

  network_name                 = module.network_docker_apps.network_name
  postgres_host                = module.storage_postgres.postgres_host
  postgres_user                = module.storage_postgres.postgres_user
  postgres_password            = random_password.postgres.result
  registry_host                = var.registry_host
  better_auth_secret           = random_password.post_api_better_auth_secret.result
  domain_api_key               = random_id.post_api_domain_key.hex
  discord_client_id            = var.discord_client_id
  discord_client_secret        = var.discord_client_secret
  discord_announce_webhook_url = var.discord_announce_webhook_url
  minio_endpoint               = module.storage_minio.endpoint
  minio_access_key             = module.storage_minio.root_user
  minio_secret_key             = random_password.minio_root_password.result
  otlp_endpoint                = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api]
}

module "compute_apps_bookclub_api" {
  source = "./modules/compute/apps/bookclub_api"
  providers = {
    docker = docker
  }

  network_name       = module.network_docker_apps.network_name
  postgres_host      = module.storage_postgres.postgres_host
  postgres_user      = module.storage_postgres.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.bookclub_api_domain_key.hex
  minio_endpoint     = module.storage_minio.endpoint
  minio_access_key   = module.storage_minio.root_user
  minio_secret_key   = random_password.minio_root_password.result
  otlp_endpoint      = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api, module.storage_minio]
}

module "compute_apps_classroom_api" {
  source = "./modules/compute/apps/classroom_api"
  providers = {
    docker = docker
  }

  network_name       = module.network_docker_apps.network_name
  postgres_host      = module.storage_postgres.postgres_host
  postgres_user      = module.storage_postgres.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.classroom_api_domain_key.hex
  otlp_endpoint      = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api]
}

# Standalone: no database, no shared auth, no domain-api. Split from
# tela-frontend (below) -- see modules/compute/apps/tela_api/main.tf.
module "compute_apps_tela_api" {
  source = "./modules/compute/apps/tela_api"
  providers = {
    docker = docker
  }

  registry_host    = var.registry_host
  sfu_public_host  = var.server_ip
  frontend_origins = ["https://tela.giomartins.dev"]
  # Host-networked container — loopback endpoint, not the docker-network one.
  otlp_endpoint = module.compute_services_observability.otlp_endpoint_loopback
}

module "compute_services_registry" {
  source = "./modules/compute/services/registry"
  providers = {
    docker = docker
  }

  registry_user     = var.registry_user
  registry_password = var.registry_password
}

module "compute_services_ingress" {
  source = "./modules/compute/services/ingress"
  providers = {
    docker = docker
  }

  services     = [for s in local.services : s if s.hostname != "registry.giomartins.dev"]
  static_sites = local.static_sites

  # Every app/service module's own published port has to already be
  # loopback-only for this to actually be the sole way in -- ordering
  # doesn't change correctness (nginx just 502s until a backend is up
  # either way), but starting ingress last keeps a `terraform apply`'s
  # resource ordering readable. static_sites has no container of its
  # own to depend on, but the buckets it proxies to need to already
  # exist -- see null_resource.static_site_buckets below.
  depends_on = [
    module.compute_apps_domain_api,
    module.compute_apps_post_api,
    module.compute_apps_bookclub_api,
    module.compute_apps_classroom_api,
    module.compute_apps_tela_api,
    module.compute_services_registry,
    module.compute_services_monitoring,
    module.compute_services_ai_proxy,
    module.compute_services_vaultwarden,
    module.compute_services_adminer,
    module.compute_services_observability,
    module.storage_minio,
    null_resource.static_site_buckets,
  ]
}

module "compute_services_monitoring" {
  source = "./modules/compute/services/monitoring"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
  agent_key    = var.beszel_agent_key
}

module "compute_services_ai_proxy" {
  source = "./modules/compute/services/ai_proxy"
  providers = {
    docker = docker
  }

  network_name     = module.network_docker_apps.network_name
  jwt_secret       = random_password.ninerouter_jwt_secret.result
  initial_password = random_password.ninerouter_initial_password.result
  hostname         = "ai.giomartins.dev"
}

module "compute_services_vaultwarden" {
  source = "./modules/compute/services/vaultwarden"
  providers = {
    docker = docker
  }

  admin_token  = random_password.vaultwarden_admin_token.result
  network_name = module.network_docker_apps.network_name
}

module "compute_services_adminer" {
  source = "./modules/compute/services/adminer"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
}

# Grafana + loki + prometheus + tempo + alloy — logs/metrics/traces for
# everything else on this VPS, with alloy as the one OTLP front door
# (see that module's README for the data flow). Its otlp_endpoint
# output is what every compute/apps/* module feeds its containers as
# OTEL_EXPORTER_OTLP_ENDPOINT.
module "compute_services_observability" {
  source = "./modules/compute/services/observability"
  providers = {
    docker = docker
  }

  network_name           = module.network_docker_apps.network_name
  grafana_admin_password = random_password.grafana_admin_password.result
  # The origins browsers may POST telemetry from. buteco-class also runs
  # as a Discord Activity, where window.location.origin is Discord's
  # wildcard *.discordsays.com proxy — that's a real origin this
  # endpoint has to accept (the wildcard form is what the receiver's
  # CORS config matches on), or every Activity user's telemetry dies on
  # its first preflight.
  frontend_origins = [
    "https://buteco-class.giomartins.dev",
    "https://tela.giomartins.dev",
    "https://*.discordsays.com",
  ]
}

# NOTE: the Project Zomboid game server is NOT a container here — it
# runs natively on the host (the VPS is arm64 and both SteamCMD and the
# game's JVM are x86-only; they run via box64, installed and managed by
# github.com/kaanzapkinus/zomboid-b42-on-arm as a systemd service).
# A docker/zomboid module was tried first: its amd64-only image
# segfaults under QEMU emulation on this box. Don't re-add it as a
# container without solving that.

module "compute_services_vaultwarden_bridge" {
  count  = var.vaultwarden_account_email == "" ? 0 : 1
  source = "./modules/compute/services/vaultwarden_bridge"
  providers = {
    docker = docker
  }

  network_name                        = module.network_docker_apps.network_name
  registry_host                       = var.registry_host
  vaultwarden_account_email           = var.vaultwarden_account_email
  vaultwarden_account_master_password = var.vaultwarden_account_master_password
  vaultwarden_api_client_id           = var.vaultwarden_api_client_id
  vaultwarden_api_client_secret       = var.vaultwarden_api_client_secret
  bridge_api_key                      = random_password.vaultwarden_bridge_api_key.result

  depends_on = [module.compute_services_vaultwarden]
}
