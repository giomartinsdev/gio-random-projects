output "protected_hostnames" {
  description = "Every hostname currently getting a Cloudflare Access application."
  value       = local.protected_hostnames
}

output "excluded_hostnames" {
  value = var.excluded_hostnames
}
