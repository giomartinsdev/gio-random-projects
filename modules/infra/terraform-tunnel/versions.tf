# Deliberately separate from modules/infra/terraform, its own state key
# in the same R2 bucket, and NOT wired into tf-deploy.yml. That config's
# docker provider only reaches dockerd by going THROUGH cloudflared
# (docker.giomartins.dev -> tunnel -> cloudflared -> docker-api-proxy ->
# dockerd) — managing cloudflared itself from inside that same loop
# means any apply that has to replace it cuts the exact channel the
# apply is using to talk to Docker, mid-apply. This config instead
# connects directly to dockerd over an SSH port-forward (see README),
# bypassing the tunnel entirely — so recreating cloudflared here never
# touches the connection this config is using to do it.
terraform {
  required_version = ">= 1.10"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket = "gio-homelab-tfstate"
    key    = "tunnel/terraform.tfstate"
    region = "auto"

    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_lockfile                = true
  }
}

provider "docker" {
  host = var.docker_host
}
