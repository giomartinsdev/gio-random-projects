# Generates the CLOUDFLARE_API_TOKEN this config's own provider (and,
# after copying it out, every run after the first) authenticates with
# — scoped to exactly what this config needs (R2 bucket management),
# nothing more. Still needs a one-time bootstrap: the apply that
# creates THIS resource can't authenticate with a token that doesn't
# exist yet. That first run uses a Global API Key instead (the
# provider reads CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY automatically
# when CLOUDFLARE_API_TOKEN isn't set) — see README.md's
# "Bootstrapping the API token" section for the exact one-time
# command.
resource "cloudflare_api_token" "bootstrap" {
  name = "gio-homelab-terraform-bootstrap"

  policies = [
    {
      # "Workers R2 Storage Write" — what cloudflare_r2_bucket.tfstate
      # actually needs.
      effect = "allow"
      permission_groups = [
        { id = "bf7481a1826f439697cb59a20b22293e" },
      ]
      resources = jsonencode({
        "com.cloudflare.api.account.${var.cloudflare_account_id}" = "*"
      })
    },
    {
      # "API Tokens Read" — not for managing OTHER tokens, only so
      # Terraform can refresh THIS resource's own state on every plan
      # (a GET against /user/tokens/{id}). Without it, every apply
      # after the first errors 403 refreshing its own token resource.
      effect = "allow"
      permission_groups = [
        { id = "0cc3a61731504c89b99ec1be78b77aa0" },
      ]
      resources = jsonencode({
        "com.cloudflare.api.user.${var.cloudflare_user_id}" = "*"
      })
    },
  ]
}

# Both permission group IDs above, and this user ID, were looked up
# once via the Cloudflare API under the Global API Key during the very
# first bootstrap apply and hardcoded rather than re-derived on every
# run — deliberately, since this resource's own scoped token has no
# broader "API Tokens" permission to look them up itself, and none of
# the three change. Re-derive by hand only if one ever starts
# erroring — see README.md's "Bootstrapping the API token" section.
