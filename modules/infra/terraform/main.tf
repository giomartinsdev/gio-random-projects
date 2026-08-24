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

  postgres_password = var.postgres_password
}

module "compute_app" {
  source = "./modules/compute/app"
  providers = {
    docker = docker
  }

  network_name           = module.compute_data.network_name
  postgres_host          = module.compute_data.postgres_host
  postgres_user          = module.compute_data.postgres_user
  postgres_password      = var.postgres_password
  redis_host             = module.compute_data.redis_host
  registry_host          = var.registry_host
  domain_api_keys        = var.domain_api_keys
  secrets_bridge_url     = try(one(module.compute_vaultwarden_bridge[*].internal_url), "")
  secrets_bridge_api_key = var.vaultwarden_bridge_api_key
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

module "compute_vaultwarden" {
  source = "./modules/compute/vaultwarden"
  providers = {
    docker = docker
  }

  admin_token  = var.vaultwarden_admin_token
  network_name = module.compute_data.network_name
}

# Absent entirely until a real Vaultwarden account exists to log in
# as (var.vaultwarden_account_email has no default, same reasoning as
# compute_monitoring's beszel_agent count guard) — nothing here can
# work before you've created that account by hand through
# vault.giomartins.dev's signup form. See
# modules/compute/vaultwarden_bridge's README for the full sequence.
module "compute_vaultwarden_bridge" {
  count  = var.vaultwarden_bridge_api_key == "" ? 0 : 1
  source = "./modules/compute/vaultwarden_bridge"
  providers = {
    docker = docker
  }

  network_name                        = module.compute_data.network_name
  vaultwarden_account_email           = var.vaultwarden_account_email
  vaultwarden_account_master_password = var.vaultwarden_account_master_password
  vaultwarden_api_client_id           = var.vaultwarden_api_client_id
  vaultwarden_api_client_secret       = var.vaultwarden_api_client_secret
  bridge_api_key                      = var.vaultwarden_bridge_api_key

  depends_on = [module.compute_vaultwarden]
}
