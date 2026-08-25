output "protected_hostnames" {
  value = module.cloud_cloudflare.protected_hostnames
}

output "excluded_hostnames" {
  value = module.cloud_cloudflare.excluded_hostnames
}

output "service_token_client_ids" {
  description = "Keyed by short name (\"docker\", \"domain\") — see modules/cloud/cloudflare/service_token_access.tf."
  value       = module.cloud_cloudflare.service_token_client_ids
}

output "service_token_client_secrets" {
  value     = module.cloud_cloudflare.service_token_client_secrets
  sensitive = true
}

output "protected_hosts_service_token_client_ids" {
  description = "Keyed by full hostname (\"vault.giomartins.dev\", \"beszel.giomartins.dev\") — see modules/cloud/cloudflare/access.tf."
  value       = module.cloud_cloudflare.protected_hosts_service_token_client_ids
}

output "protected_hosts_service_token_client_secrets" {
  value     = module.cloud_cloudflare.protected_hosts_service_token_client_secrets
  sensitive = true
}

output "registry_client_cert_pem" {
  description = "mTLS client certificate for registry.giomartins.dev — see modules/cloud/cloudflare/registry_mtls.tf."
  value       = module.cloud_cloudflare.registry_client_cert_pem
}

output "registry_client_key_pem" {
  value     = module.cloud_cloudflare.registry_client_key_pem
  sensitive = true
}
