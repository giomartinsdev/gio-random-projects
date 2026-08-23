output "protected_hostnames" {
  description = "Every hostname currently getting a Cloudflare Access application."
  value       = local.protected_hostnames
}

output "excluded_hostnames" {
  description = "Hostnames deliberately left out of Access protection (pass-through of the input variable, for visibility)."
  value       = var.excluded_hostnames
}

output "tunnel_id" {
  description = "The imported tunnel's ID."
  value       = cloudflare_zero_trust_tunnel_cloudflared.homelab.id
}

output "docker_service_token_client_id" {
  description = "Access service token Client ID for the docker provider's connection — set as the CLOUDFLARE_DOCKER_CLIENT_ID CI secret."
  value       = cloudflare_zero_trust_access_service_token.ci_docker.client_id
}

output "docker_service_token_client_secret" {
  description = "Access service token Client Secret — set as the CLOUDFLARE_DOCKER_CLIENT_SECRET CI secret."
  value       = cloudflare_zero_trust_access_service_token.ci_docker.client_secret
  sensitive   = true
}
