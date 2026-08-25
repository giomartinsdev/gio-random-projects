module "cloud_cloudflare" {
  source = "./modules/cloud/cloudflare"
  providers = {
    cloudflare = cloudflare
    tls        = tls
  }

  account_id                      = var.cloudflare_account_id
  zone_id                         = var.cloudflare_zone_id
  tunnel_id                       = var.cloudflare_tunnel_id
  google_idp_identity_provider_id = var.google_idp_identity_provider_id
  ingress_rules                   = local.ingress_rules
  excluded_hostnames              = var.excluded_hostnames
  allowed_emails                  = var.allowed_emails
  session_duration                = var.session_duration
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

  depends_on = [null_resource.postgres_password_sync]
}

module "compute_apps_post_api" {
  source = "./modules/compute/apps/post_api"
  providers = {
    docker = docker
  }

  network_name          = module.network_docker_apps.network_name
  postgres_host         = module.storage_postgres.postgres_host
  postgres_user         = module.storage_postgres.postgres_user
  postgres_password     = random_password.postgres.result
  registry_host         = var.registry_host
  better_auth_secret    = random_password.post_api_better_auth_secret.result
  domain_api_key        = random_id.post_api_domain_key.hex
  discord_client_id     = var.discord_client_id
  discord_client_secret = var.discord_client_secret

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

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api]
}

# Standalone: no database, no shared auth, no domain-api -- so unlike
# every other app module here it takes nothing but the network and the
# registry. See modules/compute/apps/tela/main.tf.
module "compute_apps_tela" {
  source = "./modules/compute/apps/tela"
  providers = {
    docker = docker
  }

  network_name  = module.network_docker_apps.network_name
  registry_host = var.registry_host
}

module "compute_apps_front" {
  source = "./modules/compute/apps/front"
  providers = {
    docker = docker
  }

  network_name  = module.network_docker_apps.network_name
  registry_host = var.registry_host
}

module "compute_services_registry" {
  source = "./modules/compute/services/registry"
  providers = {
    docker = docker
  }

  registry_user            = var.registry_user
  registry_password        = var.registry_password
  registry_client_cert_pem = module.cloud_cloudflare.registry_client_cert_pem
  registry_client_key_pem  = module.cloud_cloudflare.registry_client_key_pem
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

module "compute_services_vaultwarden_bridge" {
  count  = var.vaultwarden_account_email == "" ? 0 : 1
  source = "./modules/compute/services/vaultwarden_bridge"
  providers = {
    docker = docker
  }

  network_name                        = module.network_docker_apps.network_name
  vaultwarden_account_email           = var.vaultwarden_account_email
  vaultwarden_account_master_password = var.vaultwarden_account_master_password
  vaultwarden_api_client_id           = var.vaultwarden_api_client_id
  vaultwarden_api_client_secret       = var.vaultwarden_api_client_secret
  bridge_api_key                      = random_password.vaultwarden_bridge_api_key.result

  depends_on = [module.compute_services_vaultwarden]
}
