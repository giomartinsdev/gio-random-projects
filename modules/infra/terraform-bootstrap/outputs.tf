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
