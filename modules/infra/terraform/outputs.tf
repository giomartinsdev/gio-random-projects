output "protected_hostnames" {
  value = module.cloudflare.protected_hostnames
}

output "excluded_hostnames" {
  value = module.cloudflare.excluded_hostnames
}

output "docker_service_token_client_id" {
  value = module.cloudflare.docker_service_token_client_id
}

output "docker_service_token_client_secret" {
  value     = module.cloudflare.docker_service_token_client_secret
  sensitive = true
}
