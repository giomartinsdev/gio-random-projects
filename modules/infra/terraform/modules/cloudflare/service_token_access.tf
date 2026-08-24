# Second layer for the hostnames that can't take the Google-SSO Access
# policy applications.tf sets up for everything else — Access's
# browser-redirect login flow breaks any non-browser client
# (Terraform's docker provider, curl scripts). A service token has no
# such flow: it's two static HTTP headers
# (CF-Access-Client-Id/CF-Access-Client-Secret) any HTTP client can
# send, Docker CLI/daemon traffic excepted (see registry_mtls.tf for
# why registry.giomartins.dev needs a different mechanism instead of
# this one).
#
# WARNING: docker.giomartins.dev's token holds root-equivalent control
# of gio-server (the Docker API can mount the host filesystem into a
# container). Rotate any of these (client_secret_version += 1) if one
# ever leaks, and never grant one to anything but the specific CI job
# that needs it.
locals {
  service_token_hostnames = {
    docker = "docker.giomartins.dev"
    domain = "domain.giomartins.dev"
  }
}

resource "cloudflare_zero_trust_access_service_token" "ci" {
  for_each   = local.service_token_hostnames
  account_id = var.account_id
  name       = "ci-${each.key}-deploy"
  duration   = "8760h" # 1 year — rotate manually via client_secret_version
}

resource "cloudflare_zero_trust_access_policy" "service_token_gate" {
  for_each   = local.service_token_hostnames
  account_id = var.account_id
  name       = "${each.key}-ci-service-token"
  decision   = "non_identity" # service-to-service auth — no human login flow at all

  include = [
    { service_token = { token_id = cloudflare_zero_trust_access_service_token.ci[each.key].id } }
  ]
}

resource "cloudflare_zero_trust_access_application" "service_token_gated" {
  for_each   = local.service_token_hostnames
  account_id = var.account_id
  name       = each.value
  domain     = each.value
  type       = "self_hosted"

  policies = [{
    id         = cloudflare_zero_trust_access_policy.service_token_gate[each.key].id
    precedence = 1
  }]
}

# Chains onto the root module's own flat->module moved.tf history for
# these three (docker.giomartins.dev existed before domain.giomartins.dev
# got the same treatment) — same attribute values either way
# (name/domain unchanged), so this is a pure address rename with zero
# real API calls, not a recreate. Critical: recreating
# cloudflare_zero_trust_access_service_token.ci_docker would rotate
# the exact token CI's own docker provider connection authenticates
# with, mid-apply.
moved {
  from = cloudflare_zero_trust_access_service_token.ci_docker
  to   = cloudflare_zero_trust_access_service_token.ci["docker"]
}

moved {
  from = cloudflare_zero_trust_access_policy.docker_service_token
  to   = cloudflare_zero_trust_access_policy.service_token_gate["docker"]
}

moved {
  from = cloudflare_zero_trust_access_application.docker
  to   = cloudflare_zero_trust_access_application.service_token_gated["docker"]
}
