# Reusable policy, one per hostname: allow any of var.allowed_emails
# (or literally anyone, for hostnames opted into var.public_signup_hostnames
# -- financas' "create your account by just logging in with Google"
# flow), but only if they authenticated via the specific Google IdP
# (not "logged in via literally any configured provider").
resource "cloudflare_zero_trust_access_policy" "google_sso" {
  for_each = local.protected_hostnames

  account_id = var.account_id
  name       = "google-sso-${each.key}"
  decision   = "allow"

  # Public-signup hostnames: everyone who clears the require below
  # (this specific Google IdP) gets in, full stop -- no email
  # allowlist. Every other hostname: a set of OR'd condition groups,
  # one per allowed email, since the `email` condition itself only
  # takes a single address.
  include = contains(var.public_signup_hostnames, each.key) ? [
    { everyone = {} }
    ] : [
    for email in var.allowed_emails : { email = { email = email } }
  ]

  # AND'd against every include match: must also have used this
  # specific Google identity provider. Unchanged for public-signup
  # hostnames -- this is the ONLY gate left there, so it still matters.
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

  # Browsers never send cookies on a CORS preflight (OPTIONS), so
  # without this Access 403s every preflighted cross-origin fetch even
  # for a logged-in user and the browser never gets to the real
  # request. With the bypass the preflight hits the origin's own CORS
  # middleware; the actual API call still goes through Access exactly
  # as before.
  options_preflight_bypass = contains(var.preflight_bypass_hostnames, each.value)

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
