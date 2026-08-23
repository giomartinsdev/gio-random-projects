# State lives in this homelab's own MinIO (infra/minio, S3-compatible)
# rather than any third-party cloud storage — one more service on
# gio-server instead of an external account dependency. Most backend
# fields are deliberately absent here (endpoint, access keys) —
# supplied via `-backend-config` at init time. See README.md's one-time
# setup.
terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "tfstate"
    key    = "cloudflare-access/terraform.tfstate"
    region = "us-east-1"

    # MinIO isn't AWS: it needs path-style bucket addressing, and
    # asking the AWS provider logic to skip these AWS-only checks is
    # required for the S3 backend to work against any non-AWS
    # S3-compatible target at all.
    use_path_style               = true
    skip_credentials_validation  = true
    skip_region_validation       = true
    skip_requesting_account_id   = true
    skip_s3_checksum             = true
    skip_metadata_api_check      = true
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment — never set inline
  # here. Needs Account / Access: Apps and Policies / Edit (broader
  # than dns-sync's Zone / DNS / Edit token — see README.md).
}
