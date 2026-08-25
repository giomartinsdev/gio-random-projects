# Reusable policy, one per hostname: allow any of var.allowed_emails,
# but only if they authenticated via the specific Google IdP (not
# "logged in via literally any configured provider").
resource "cloudflare_zero_trust_access_policy" "google_sso" {
  for_each = local.protected_hostnames

  account_id = var.account_id
  name       = "google-sso-${each.key}"
  decision   = "allow"

  # A set of OR'd condition groups — one per allowed email, since the
  # `email` condition itself only takes a single address.
  include = [
    for email in var.allowed_emails : { email = { email = email } }
  ]

  # AND'd against every include match: must also have used this
  # specific Google identity provider.
  require = [
    { login_method = { id = var.google_idp_identity_provider_id } }
  ]
}

# Every protected hostname also gets a dedicated service token as an
# OR'd alternative to Google SSO -- a CI job or script can hit it with
# CF-Access-Client-Id/Secret headers instead of a browser login. Purely
# additive: the google_sso policy/its own resource above is untouched,
# this only adds a second policy option to the application below.
resource "cloudflare_zero_trust_access_service_token" "protected_hosts" {
  for_each   = local.protected_hostnames
  account_id = var.account_id
  name       = "ci-${each.key}"
  duration   = "8760h" # 1 year — rotate manually via client_secret_version
}

resource "cloudflare_zero_trust_access_policy" "protected_hosts_service_token" {
  for_each   = local.protected_hostnames
  account_id = var.account_id
  name       = "service-token-${each.key}"
  decision   = "non_identity" # service-to-service auth — no human login flow at all

  include = [
    { service_token = { token_id = cloudflare_zero_trust_access_service_token.protected_hosts[each.key].id } }
  ]
}

resource "cloudflare_zero_trust_access_application" "protected" {
  for_each = local.protected_hostnames

  account_id       = var.account_id
  name             = each.value
  domain           = each.value
  type             = "self_hosted"
  session_duration = var.session_duration

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.google_sso[each.key].id
      precedence = 1
    },
    {
      id         = cloudflare_zero_trust_access_policy.protected_hosts_service_token[each.key].id
      precedence = 2
    },
  ]
}
