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

output "service_token_client_ids" {
  description = "Access service token Client IDs, keyed by service_token_hostnames' short name (\"docker\", \"domain\") — set as the CLOUDFLARE_<KEY>_CLIENT_ID CI secrets."
  value       = { for k, v in cloudflare_zero_trust_access_service_token.ci : k => v.client_id }
}

output "service_token_client_secrets" {
  description = "Access service token Client Secrets, keyed the same way — set as the CLOUDFLARE_<KEY>_CLIENT_SECRET CI secrets."
  value       = { for k, v in cloudflare_zero_trust_access_service_token.ci : k => v.client_secret }
  sensitive   = true
}

output "registry_client_cert_pem" {
  description = "mTLS client certificate for registry.giomartins.dev — install at /etc/docker/certs.d/registry.giomartins.dev/client.cert wherever docker push/pull happens (CI, gio-server for watchtower). See registry_mtls.tf."
  value       = tls_locally_signed_cert.registry_client.cert_pem
}

output "registry_client_key_pem" {
  description = "Matching private key — .../client.key alongside the cert above."
  value       = tls_private_key.registry_client.private_key_pem
  sensitive   = true
}

output "registry_ca_cert_pem" {
  description = "The CA cert cloudflare_mtls_certificate.registry_ca should hold — used by the root module's imports.tf to find the matching orphan by content, not by index. See that file's comment."
  value       = tls_self_signed_cert.registry_ca.cert_pem
}
