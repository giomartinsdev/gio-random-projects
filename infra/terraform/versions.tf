# State lives in Cloudflare R2 (S3-compatible) — the bucket itself is
# managed as code too (infra/terraform-bootstrap, run once — see that
# directory's README for why it can't be this same config: it creates
# the bucket this state lives in, so it can't depend on that bucket
# already existing). Most backend fields are deliberately absent here
# (endpoint, access keys) — supplied via `-backend-config` at init
# time. See README.md's one-time setup.
terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "gio-homelab-tfstate"
    key    = "cloudflare-access/terraform.tfstate"
    region = "auto"

    # R2 has no concept of these S3 features; asking the AWS provider
    # logic to skip them is required for the S3 backend to work against
    # R2 at all (documented in Cloudflare's own R2-as-Terraform-backend
    # guide).
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment — never set inline
  # here. Needs Account / Access: Apps and Policies / Edit (broader
  # than dns-sync's Zone / DNS / Edit token — see README.md).
}
