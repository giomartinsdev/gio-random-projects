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

resource "cloudflare_zero_trust_access_application" "protected" {
  for_each = local.protected_hostnames

  account_id       = var.account_id
  name             = each.value
  domain           = each.value
  type             = "self_hosted"
  session_duration = var.session_duration

  policies = [{
    id         = cloudflare_zero_trust_access_policy.google_sso[each.key].id
    precedence = 1
  }]
}
