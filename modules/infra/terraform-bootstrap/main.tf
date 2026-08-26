resource "cloudflare_r2_bucket" "tfstate" {
  account_id = var.cloudflare_account_id
  name       = "gio-homelab-tfstate"
  location   = "ENAM" # Eastern North America — closest region to Cloudflare's default edge for this account
}

# The S3 Access Key ID/Secret Access Key pair to actually read/write
# this bucket can't be created here — Cloudflare doesn't expose R2 API
# token/access-key generation through this provider (only bucket
# management). Create it once by hand: R2 → Manage API Tokens → Create
# API Token → Object Read & Write, scoped to this bucket. See
# modules/infra/terraform/README.md for what happens with it next.
