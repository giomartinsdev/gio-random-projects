# State lives in Cloudflare R2 (S3-compatible) — the bucket itself is
# managed as code too (modules/infra/terraform-bootstrap, run once —
# see that directory's README for why it can't be this same config: it
# creates the bucket this state lives in, so it can't depend on that
# bucket already existing). Most backend fields are deliberately absent
# here (endpoint, access keys) — supplied via `-backend-config` at init
# time. See README.md's one-time setup.
#
# Provider configuration lives only here, at root — child modules only
# declare required_providers (their own versions.tf) and receive a
# configured provider instance explicitly via each module block's
# `providers = {}` argument in main.tf. Modules that configure their
# own provider blocks can't be safely reused or tested in isolation;
# keeping configuration at the root is what makes cloudflare/ and
# compute/* actually composable.
terraform {
  required_version = ">= 1.10" # use_lockfile below needs this

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

  backend "s3" {
    bucket = "gio-homelab-tfstate"
    key    = "cloudflare-access/terraform.tfstate"
    region = "auto"

    # R2 has no concept of these S3 features (or, for use_path_style,
    # needs it explicitly since the AWS provider defaults to
    # virtual-hosted-style addressing, which fails TLS against R2's
    # wildcard cert setup) — required for the S3 backend to work
    # against R2 at all (documented in Cloudflare's own
    # R2-as-Terraform-backend guide, confirmed live: omitting
    # use_path_style produced a TLS handshake failure).
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true

    # R2 has no DynamoDB equivalent for the S3 backend's traditional
    # locking mechanism — this is the native S3-conditional-write
    # locking Terraform 1.10+ added instead, which R2 does support.
    use_lockfile = true
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment — never set inline
  # here. Needs Account / Access: Apps and Policies / Edit, Account /
  # Access: Organizations, Identity Providers, and Groups / Read, and
  # Zone / DNS / Edit — see modules/cloudflare's README.
}

provider "docker" {
  # Points at a local header-injecting proxy (nginx), NOT directly at
  # docker.giomartins.dev — this provider has no way to attach the
  # CF-Access-Client-Id/Secret headers Access requires itself. The
  # proxy forwards to https://docker.giomartins.dev with those headers
  # injected; this only ever talks to localhost. See README.md and
  # .github/workflows/tf-deploy.yml's sidecar step.
  host = var.docker_host
}
