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

  network_name      = module.compute_data.network_name
  postgres_host     = module.compute_data.postgres_host
  postgres_user     = module.compute_data.postgres_user
  postgres_password = var.postgres_password
  redis_host        = module.compute_data.redis_host
  registry_host     = var.registry_host
  domain_api_keys   = var.domain_api_keys
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
