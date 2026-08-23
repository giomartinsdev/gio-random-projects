# Exposes gio-server's Docker daemon to this same Terraform config (and
# only to it) so a later pass can manage containers — postgres, redis,
# api, worker — as docker_container resources instead of docker-compose
# + Watchtower. Not full mTLS: dockerd listens on 127.0.0.1:2375 only
# (plain HTTP, no daemon-side TLS — never reachable except via this
# tunnel hop, itself running on the same host), and the auth boundary
# is entirely Cloudflare Access's service-token policy below, not a
# client certificate — chosen over true mTLS because a standard
# Cloudflare Tunnel HTTP ingress rule terminates TLS at Cloudflare's
# edge, so a client certificate presented by Terraform/CI would never
# reach dockerd anyway; raw TCP tunneling to preserve that would be a
# meaningfully bigger CI-side setup for an equivalent security outcome.
#
# WARNING: whoever holds this service token's secret has root-equivalent
# control of gio-server (the Docker API can mount the host filesystem
# into a container). Rotate it (client_secret_version += 1) if it ever
# leaks, and never grant it to anything but the CI pipeline that needs
# it.
resource "cloudflare_zero_trust_access_service_token" "ci_docker" {
  account_id = var.cloudflare_account_id
  name       = "ci-docker-deploy"
  duration   = "8760h" # 1 year — rotate manually via client_secret_version
}

resource "cloudflare_zero_trust_access_policy" "docker_service_token" {
  account_id = var.cloudflare_account_id
  name       = "docker-ci-service-token"
  decision   = "non_identity" # service-to-service auth — no human login flow at all

  include = [
    { service_token = { token_id = cloudflare_zero_trust_access_service_token.ci_docker.id } }
  ]
}

resource "cloudflare_zero_trust_access_application" "docker" {
  account_id = var.cloudflare_account_id
  name       = "docker.giomartins.dev"
  domain     = "docker.giomartins.dev"
  type       = "self_hosted"

  policies = [{
    id         = cloudflare_zero_trust_access_policy.docker_service_token.id
    precedence = 1
  }]
}

output "docker_service_token_client_id" {
  value = cloudflare_zero_trust_access_service_token.ci_docker.client_id
}

output "docker_service_token_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.ci_docker.client_secret
  sensitive = true
}
