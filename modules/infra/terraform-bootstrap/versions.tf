# Deliberately LOCAL state, not remote, for every resource here — not
# just the bucket. Two independent reasons land on the same answer:
#
#  - cloudflare_r2_bucket.tfstate CREATES the bucket modules/infra/terraform's
#    own remote state lives in, so it can't depend on that bucket
#    existing yet (chicken-and-egg).
#  - docker_container.cloudflared and the docker-api-proxy resources
#    are the two containers modules/infra/terraform's own docker
#    provider connects THROUGH to reach dockerd. Managing them from
#    inside that config would mean any apply needing to replace either
#    one cuts the exact channel that apply is using to talk to Docker,
#    mid-apply.
#
# Run by a human, from a machine that has `terraform.tfstate` sitting
# next to it afterwards — see README.md. Not wired into CI for either
# reason above: there's nowhere durable for the bucket bootstrap's
# state to live before the bucket exists, and CI's own docker provider
# is exactly the connection this config exists to not depend on.
terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}

# Connects directly to dockerd over an SSH port-forward, never through
# the tunnel — see README.md's "Running it" section for the exact
# port-forward command this expects already running.
provider "docker" {
  host = var.docker_host
}
