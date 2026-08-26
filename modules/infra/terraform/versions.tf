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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
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
  # Talks straight to the VPS dockerd over SSH (var.docker_host) — the
  # same channel a human `docker` CLI would use, no exposed TCP port,
  # no Access service token, no header-injecting proxy anywhere in the
  # path. The remote host needs the key in the caller's ssh-agent (CI:
  # tf-deploy.yml's SSH setup step; locally: your own agent).
  #
  # A pull triggered over the Docker API (as this provider does, unlike
  # the docker CLI) carries its own auth per-request — dockerd does NOT
  # fall back to the host's `docker login`-populated config.json for
  # API-originated pulls. registry_auth below supplies that per-pull;
  # without it, every docker_container/docker_image resource pulling
  # from registry.giomartins.dev (htpasswd-gated) fails with "no basic
  # auth credentials".
  registry_auth {
    address  = var.registry_host
    username = var.registry_user
    password = var.registry_password
  }
  host = var.docker_host
}

provider "tls" {
  # Stateless — no credentials, generates registry.giomartins.dev's
  # mTLS CA and client certificate locally (module.cloudflare's
  # registry_mtls.tf). See that file for why mTLS instead of an Access
  # application for this one hostname.
}
