output "bucket_name" {
  value = cloudflare_r2_bucket.tfstate.name
}

output "bootstrap_api_token" {
  description = <<-EOT
    The token value — copy this into CLOUDFLARE_API_TOKEN for every
    run after the first (see README.md's "Bootstrapping the API
    token"). Never printed by plan/apply's own log output regardless
    of this sensitive marking — only `terraform output
    bootstrap_api_token` reveals it.
  EOT
  value       = cloudflare_api_token.bootstrap.value
  sensitive   = true
}
