output "internal_url" {
  description = "http://<container-name>:8080 — what domain-api/domain-worker's SECRETS_BRIDGE_URL should point at."
  value       = "http://${docker_container.vaultwarden_bridge.name}:8080"
}
