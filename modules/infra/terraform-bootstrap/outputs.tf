output "bucket_name" {
  value = cloudflare_r2_bucket.tfstate.name
}

output "cloudflared_container_id" {
  description = "For manual verification after an apply — e.g. `docker logs <id>` over the same SSH tunnel."
  value       = docker_container.cloudflared.id
}

output "docker_api_proxy_image_id" {
  description = "The built docker-api-proxy image's ID — changes whenever proxy.py or its Dockerfile do, per the triggers on docker_image.docker_api_proxy."
  value       = docker_image.docker_api_proxy.image_id
}

output "beszel_proxy_image_id" {
  description = "The built beszel-proxy image's ID — changes whenever its proxy.py or Dockerfile do."
  value       = docker_image.beszel_proxy.image_id
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
