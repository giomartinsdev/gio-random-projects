# Terraform-generated secrets for compute/data, compute/app, and
# compute/vaultwarden -- replacing the old pattern of generating these
# by hand (openssl rand) and feeding them in as GH Action secrets.
# Terraform now owns generation, wires the values into the containers
# that need them, and pushes a copy of each into Vaultwarden itself --
# see modules/compute/vaultwarden_bridge's README for why the vault
# needs its own copy (the bridge re-serves these to domain-api/worker
# at runtime instead of the container's own baked-in env vars).
#
# registry_password and beszel_agent_key are NOT generated here.
# beszel_agent_key comes from Beszel's own dashboard. registry_password
# stays a real input (var.registry_password) because the root docker
# provider block (versions.tf) also needs it for registry_auth, and a
# provider configuration can't depend on a resource's value computed in
# the same apply (would be unknown on the very first transition apply).
# It still gets the same automation as everything else here though --
# see modules/compute/registry's docker_config_install and this file's
# registry_restart/vault_seed below -- generation is just still manual.

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "random_id" "domain_api_key" {
  byte_length = 24
}

locals {
  domain_api_keys = "${random_id.domain_api_key.hex}:ci"
}

resource "random_password" "vaultwarden_admin_token" {
  length  = 48
  special = false
}

resource "random_password" "vaultwarden_bridge_api_key" {
  length  = 32
  special = false
}

# Postgres only applies POSTGRES_PASSWORD on first init of an empty
# data volume -- changing the env var alone does nothing once the
# volume already has data, and would leave domain-api/domain-worker
# unable to connect with a DATABASE_URL that no longer matches the
# real DB password. This runs ALTER USER directly against the live
# Postgres so both stay in sync, and only fires when the generated
# password actually changes.
resource "null_resource" "postgres_password_sync" {
  triggers = {
    password = random_password.postgres.result
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST     = var.docker_host
      PG_USER         = module.compute_data.postgres_user
      PG_NEW_PASSWORD = random_password.postgres.result
    }
    # -d (detach): a non-detached `docker exec` always hijacks the
    # connection into a raw stream to relay stdio, even without -it --
    # and that hijack doesn't survive the CI Access proxy/tunnel hop
    # (fails with "unable to upgrade to tcp, received 200"). Detached
    # exec skips that entirely: plain request/response, same as the
    # container create/start calls that already work through this
    # proxy. Trade-off: no exit status back, hence the fixed sleep
    # margin before anything depends on this having finished --
    # ALTER USER is a fast in-memory catalog update.
    command = <<-EOT
      docker exec -d postgres psql -U "$PG_USER" -d "$PG_USER" \
        -c "ALTER USER \"$PG_USER\" WITH PASSWORD '$PG_NEW_PASSWORD';"
      sleep 3
    EOT
  }

  depends_on = [module.compute_data]
}

# Changing registry_password recreates htpasswd_init and
# docker_config_install (both reference it directly), but neither
# `registry` nor `watchtower` reference the password themselves, so
# nothing forces them to pick up the rewritten htpasswd/config.json
# files on their own -- see modules/compute/registry's README. A plain
# `docker restart` (not exec/attach) is enough; both just re-read their
# mounted files on startup.
resource "null_resource" "registry_restart" {
  triggers = {
    password = var.registry_password
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST = var.docker_host
    }
    command = "docker restart registry watchtower"
  }

  depends_on = [module.compute_registry]
}

# Pushes DATABASE_URL/DOMAIN_API_KEYS/the two Vaultwarden tokens into
# the vault over the internal docker network -- see scripts/seed_vault.sh
# for why that still needs a local HTTPS-terminating proxy despite
# being purely internal traffic. Only reruns when one of the values it
# writes actually changes.
resource "null_resource" "vault_seed" {
  triggers = {
    postgres_password = random_password.postgres.result
    domain_api_keys    = local.domain_api_keys
    admin_token        = random_password.vaultwarden_admin_token.result
    bridge_api_key     = random_password.vaultwarden_bridge_api_key.result
    registry_password  = var.registry_password
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST                         = var.docker_host
      NETWORK_NAME                        = module.compute_data.network_name
      VAULTWARDEN_CLIENT_ID               = var.vaultwarden_api_client_id
      VAULTWARDEN_CLIENT_SECRET           = var.vaultwarden_api_client_secret
      VAULTWARDEN_MASTER_PASSWORD         = var.vaultwarden_account_master_password
      DATABASE_URL_VALUE                  = "postgresql://${module.compute_data.postgres_user}:${random_password.postgres.result}@${module.compute_data.postgres_host}:5432/${module.compute_data.postgres_user}"
      DOMAIN_API_KEYS_VALUE               = local.domain_api_keys
      TF_VAULTWARDEN_ADMIN_TOKEN_VALUE    = random_password.vaultwarden_admin_token.result
      TF_VAULTWARDEN_BRIDGE_API_KEY_VALUE = random_password.vaultwarden_bridge_api_key.result
      REGISTRY_PASSWORD_VALUE             = var.registry_password
    }
    command = "${path.module}/scripts/seed_vault.sh"
  }

  depends_on = [module.compute_vaultwarden, module.compute_data, null_resource.postgres_password_sync, null_resource.registry_restart]
}
