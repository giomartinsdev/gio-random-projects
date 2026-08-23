# Deliberately LOCAL state, not remote — this is what CREATES the R2
# bucket that modules/infra/terraform's own remote state lives in, so it can't
# depend on that bucket existing yet (chicken-and-egg). Run once, by a
# human, from a machine that has `terraform.tfstate` sitting next to it
# afterwards — see README.md. Not wired into CI for the same reason:
# there's nowhere durable for its state to live between CI runs without
# first solving the exact problem this bootstraps.
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
