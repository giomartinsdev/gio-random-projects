# Deliberately LOCAL state, not remote: cloudflare_r2_bucket.tfstate
# CREATES the bucket modules/infra/terraform's own remote state lives
# in, so it can't depend on that bucket existing yet (chicken-and-egg).
#
# Run once by a human, from a machine that has `terraform.tfstate`
# sitting next to it afterwards — see README.md. Not wired into CI:
# there's nowhere durable for the bucket bootstrap's state to live
# before the bucket exists.
terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}
