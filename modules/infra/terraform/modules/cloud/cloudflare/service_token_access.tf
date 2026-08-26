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
# WARNING: these tokens are only as strong as what they unlock --
# domain.giomartins.dev's token can drive the whole CQRS API. Rotate
# any of them (client_secret_version += 1) if one ever leaks, and
# never grant one to anything but the specific CI job that needs it.
locals {
  service_token_hostnames = {
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

# OR'd alternative to the service token above -- lets a human log in
# via Google SSO too (e.g. to poke the Docker API through a browser
# tool), without touching the service token itself. Purely additive.
resource "cloudflare_zero_trust_access_policy" "service_token_hosts_google_sso" {
  for_each   = local.service_token_hostnames
  account_id = var.account_id
  name       = "google-sso-${each.key}"
  decision   = "allow"

  include = [
    for email in var.allowed_emails : { email = { email = email } }
  ]

  require = [
    { login_method = { id = var.google_idp_identity_provider_id } }
  ]
}

resource "cloudflare_zero_trust_access_application" "service_token_gated" {
  for_each   = local.service_token_hostnames
  account_id = var.account_id
  name       = each.value
  domain     = each.value
  type       = "self_hosted"

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.service_token_gate[each.key].id
      precedence = 1
    },
    {
      id         = cloudflare_zero_trust_access_policy.service_token_hosts_google_sso[each.key].id
      precedence = 2
    },
  ]
}
