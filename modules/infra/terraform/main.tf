module "cloudflare" {
  source = "./modules/cloudflare"
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

module "compute_data" {
  source = "./modules/compute/data"
  providers = {
    docker = docker
  }

  postgres_password = random_password.postgres.result
}

module "compute_app" {
  source = "./modules/compute/app"
  providers = {
    docker = docker
  }

  network_name           = module.compute_data.network_name
  postgres_host          = module.compute_data.postgres_host
  postgres_user          = module.compute_data.postgres_user
  postgres_password      = random_password.postgres.result
  redis_host             = module.compute_data.redis_host
  registry_host          = var.registry_host
  domain_api_keys        = local.domain_api_keys
  secrets_bridge_url     = length(module.compute_vaultwarden_bridge) > 0 ? module.compute_vaultwarden_bridge[0].internal_url : ""
  secrets_bridge_api_key = random_password.vaultwarden_bridge_api_key.result

  # Without this, nothing guarantees ALTER USER (null_resource.
  # postgres_password_sync, secrets.tf) finishes before these
  # containers restart with the new DATABASE_URL — they could come up
  # with a password the live DB doesn't have yet.
  depends_on = [null_resource.postgres_password_sync]
}

module "compute_post_api" {
  source = "./modules/compute/post_api"
  providers = {
    docker = docker
  }

  network_name       = module.compute_data.network_name
  postgres_host      = module.compute_data.postgres_host
  postgres_user      = module.compute_data.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.post_api_domain_key.hex

  # Runtime dependency (reaches domain-api by container name over the
  # shared network), not a Terraform attribute reference -- this
  # depends_on is what still orders its creation after compute_app's.
  depends_on = [null_resource.postgres_password_sync, module.compute_app]
}

module "compute_minio" {
  source = "./modules/compute/minio"
  providers = {
    docker = docker
  }

  network_name  = module.compute_data.network_name
  root_password = random_password.minio_root_password.result
}

module "compute_bookclub_api" {
  source = "./modules/compute/bookclub_api"
  providers = {
    docker = docker
  }

  network_name       = module.compute_data.network_name
  postgres_host      = module.compute_data.postgres_host
  postgres_user      = module.compute_data.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.bookclub_api_domain_key.hex
  minio_endpoint     = module.compute_minio.endpoint
  minio_access_key   = module.compute_minio.root_user
  minio_secret_key   = random_password.minio_root_password.result

  # Runtime dependency (reaches domain-api/minio by container name over
  # the shared network), not a Terraform attribute reference -- same
  # reasoning as module.compute_post_api's own depends_on.
  depends_on = [null_resource.postgres_password_sync, module.compute_app, module.compute_minio]
}

module "compute_front" {
  source = "./modules/compute/front"
  providers = {
    docker = docker
  }

  network_name  = module.compute_data.network_name
  registry_host = var.registry_host
}

module "compute_registry" {
  source = "./modules/compute/registry"
  providers = {
    docker = docker
  }

  registry_user            = var.registry_user
  registry_password        = var.registry_password
  registry_client_cert_pem = module.cloudflare.registry_client_cert_pem
  registry_client_key_pem  = module.cloudflare.registry_client_key_pem
}

module "compute_monitoring" {
  source = "./modules/compute/monitoring"
  providers = {
    docker = docker
  }

  network_name = module.compute_data.network_name
  agent_key    = var.beszel_agent_key
}

module "compute_ninerouter" {
  source = "./modules/compute/9router"
  providers = {
    docker = docker
  }

  network_name     = module.compute_data.network_name
  jwt_secret       = random_password.ninerouter_jwt_secret.result
  initial_password = random_password.ninerouter_initial_password.result
  hostname         = "ai.giomartins.dev"
}

module "compute_vaultwarden" {
  source = "./modules/compute/vaultwarden"
  providers = {
    docker = docker
  }

  admin_token  = random_password.vaultwarden_admin_token.result
  network_name = module.compute_data.network_name
}

# Absent entirely until a real Vaultwarden account exists to log in
# as (var.vaultwarden_account_email has no default, same reasoning as
# compute_monitoring's beszel_agent count guard) — nothing here can
# work before you've created that account by hand through
# vault.giomartins.dev's signup form. See
# modules/compute/vaultwarden_bridge's README for the full sequence.
module "compute_vaultwarden_bridge" {
  count  = var.vaultwarden_account_email == "" ? 0 : 1
  source = "./modules/compute/vaultwarden_bridge"
  providers = {
    docker = docker
  }

  network_name                        = module.compute_data.network_name
  vaultwarden_account_email           = var.vaultwarden_account_email
  vaultwarden_account_master_password = var.vaultwarden_account_master_password
  vaultwarden_api_client_id           = var.vaultwarden_api_client_id
  vaultwarden_api_client_secret       = var.vaultwarden_api_client_secret
  bridge_api_key                      = random_password.vaultwarden_bridge_api_key.result

  depends_on = [module.compute_vaultwarden]
}
