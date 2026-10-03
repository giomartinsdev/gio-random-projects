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

resource "random_password" "minio_root_password" {
  length  = 32
  special = false
}

resource "random_id" "domain_api_key" {
  byte_length = 24
}

# clubs-api's session-signing secret. The hub no longer sits behind Cloudflare
# Access: the SPA sends a Google ID token, clubs-api verifies it and mints an
# HS256 cookie signed with this. It never leaves the infrastructure -- terraform
# wires it straight into the container's env, so there is no Vaultwarden item to
# keep in sync.
resource "random_password" "clubs_session_secret" {
  length  = 48
  special = false
}

# clubs-api's own key -- the FC Clubs Hub's per-person writes (watchlist,
# claimed pro, notification prefs) go through domain-api's command pipeline, so
# the audit log needs a caller identity for it. No Vaultwarden item: terraform
# wires the key straight into the container's env.
resource "random_id" "clubs_api_domain_key" {
  byte_length = 24
}

# clubs-ingest's own key, deliberately SEPARATE from clubs_api_domain_key --
# the ingest worker and the BFF are different writers, and one shared key would
# make the audit log unable to name which of them touched a club.
resource "random_id" "clubs_ingest_domain_key" {
  byte_length = 24
}

locals {
  domain_api_keys = "${random_id.domain_api_key.hex}:ci,${random_id.clubs_api_domain_key.hex}:clubs-api,${random_id.clubs_ingest_domain_key.hex}:clubs-ingest"
}

resource "random_password" "vaultwarden_admin_token" {
  length  = 48
  special = false
}

resource "random_password" "vaultwarden_bridge_api_key" {
  length  = 32
  special = false
}

# 9router secrets — JWT signing key and dashboard initial password.
# Both Terraform-generated; retrieve NINEROUTER_INITIAL_PASSWORD from
# Vaultwarden after the first apply to log into the dashboard.
resource "random_password" "ninerouter_jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "ninerouter_initial_password" {
  length  = 24
  special = false
}

# Grafana's admin login — retrieve GRAFANA_ADMIN_PASSWORD from
# Vaultwarden after the first apply. The outer layer in front of it is
# Cloudflare Access (grafana.giomartins.dev, Google SSO — same shape as
# beszel), this is the inner one. Write-once caveat, same class of
# problem as postgres's init-only password below: Grafana creates the
# admin user on the container's FIRST boot with whatever env var it
# sees; changing the password afterwards needs the container recreated
# (tf-ci-cd.yml's replace_target dispatch: docker_container.grafana).
resource "random_password" "grafana_admin_password" {
  length  = 32
  special = false
}

# coturn's `static-auth-secret`: tela-api uses it to mint short-lived TURN
# credentials (the TURN REST API -- hmac(secret, "<expiry>:<id>")) that
# coturn independently verifies. Nothing long-lived reaches a browser,
# and the relay can't be used by anyone tela-api didn't hand a credential
# to. Rotating it invalidates every outstanding credential immediately.
resource "random_password" "tela_turn_secret" {
  length  = 48
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
      PG_USER         = module.storage_postgres.postgres_user
      PG_NEW_PASSWORD = random_password.postgres.result
    }
    command = <<-EOT
      docker exec postgres psql -U "$PG_USER" -d "$PG_USER" \
        -c "ALTER USER \"$PG_USER\" WITH PASSWORD '$PG_NEW_PASSWORD';"
    EOT
  }

  depends_on = [module.storage_postgres]
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

  depends_on = [module.compute_services_registry]
}

# One group per logically-independent value (or tightly-coupled pair,
# like a service token's id+secret) -- each becomes its OWN
# null_resource below via for_each, with its OWN narrow trigger.
# Previously this was a single null_resource with every value in one
# combined trigger map: any ONE secret changing replaced the whole
# resource and resent every item through seed_vault.sh, even the ones
# that hadn't changed. Now only the group whose value actually
# changed reruns.
#
# KNOWN GAP, hit for real once: when TWO OR MORE groups change in the
# same apply, Terraform runs their null_resources (and thus two
# concurrent seed_vault.sh containers) in parallel by default. Both
# log into the SAME Vaultwarden account and snapshot `bw list items`
# independently -- if they race on editing the SAME existing item
# (not just creating different new ones), one process's edit can be
# silently lost even though its own container exits 0. It happened once
# when domain_api_keys (edit) and another group (new item) landed in the
# same apply: domain_api_keys' write never actually stuck.
# No proper fix yet (would need real mutual exclusion in
# seed_vault.sh, or forcing -parallelism=1 on every apply); the
# workaround is `gh workflow run` this file with `replace_target` set
# to the lost group (e.g. `null_resource.vault_seed["domain_api_keys"]`)
# on its own, once nothing else is changing concurrently.
locals {
  vault_item_groups = {
    database_url = {
      trigger = random_password.postgres.result
      items = {
        DATABASE_URL = "postgresql://${module.storage_postgres.postgres_user}:${random_password.postgres.result}@${module.storage_postgres.postgres_host}:5432/${module.storage_postgres.postgres_user}"
      }
    }
    domain_api_keys = {
      trigger = local.domain_api_keys
      items   = { DOMAIN_API_KEYS = local.domain_api_keys }
    }
    vaultwarden_admin_token = {
      trigger = random_password.vaultwarden_admin_token.result
      items   = { TF_VAULTWARDEN_ADMIN_TOKEN = random_password.vaultwarden_admin_token.result }
    }
    vaultwarden_bridge_api_key = {
      trigger = random_password.vaultwarden_bridge_api_key.result
      items   = { TF_VAULTWARDEN_BRIDGE_API_KEY = random_password.vaultwarden_bridge_api_key.result }
    }
    # Grouped (not 4 separate resources): these four all describe the
    # same "how do I authenticate to the registry" concern and, in
    # practice, rotate together.
    registry = {
      trigger = "${var.registry_password}|${module.cloud_cloudflare.registry_client_cert_pem}"
      items = {
        REGISTRY_PASSWORD    = var.registry_password
        REGISTRY_USERNAME    = var.registry_user
        REGISTRY_CLIENT_CERT = module.cloud_cloudflare.registry_client_cert_pem
        REGISTRY_CLIENT_KEY  = module.cloud_cloudflare.registry_client_key_pem
      }
    }
    # Each service token's id+secret are two attributes of the same
    # underlying resource -- they only ever change together, so one
    # group per hostname, not one per attribute.
    access_svc_token_domain = {
      trigger = module.cloud_cloudflare.service_token_client_ids["domain"]
      items = {
        ACCESS_SVC_TOKEN_DOMAIN_CLIENT_ID     = module.cloud_cloudflare.service_token_client_ids["domain"]
        ACCESS_SVC_TOKEN_DOMAIN_CLIENT_SECRET = module.cloud_cloudflare.service_token_client_secrets["domain"]
      }
    }
    access_svc_token_vault = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["vault.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_VAULT_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["vault.giomartins.dev"]
        ACCESS_SVC_TOKEN_VAULT_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["vault.giomartins.dev"]
      }
    }
    access_svc_token_beszel = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["beszel.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_BESZEL_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["beszel.giomartins.dev"]
        ACCESS_SVC_TOKEN_BESZEL_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["beszel.giomartins.dev"]
      }
    }
    access_svc_token_minio = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["minio.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_MINIO_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["minio.giomartins.dev"]
        ACCESS_SVC_TOKEN_MINIO_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["minio.giomartins.dev"]
      }
    }
    minio = {
      trigger = random_password.minio_root_password.result
      items = {
        MINIO_ROOT_USER     = module.storage_minio.root_user
        MINIO_ROOT_PASSWORD = random_password.minio_root_password.result
      }
    }
    ninerouter = {
      trigger = "${random_password.ninerouter_jwt_secret.result}|${random_password.ninerouter_initial_password.result}"
      items = {
        NINEROUTER_JWT_SECRET       = random_password.ninerouter_jwt_secret.result
        NINEROUTER_INITIAL_PASSWORD = random_password.ninerouter_initial_password.result
      }
    }
    grafana = {
      trigger = random_password.grafana_admin_password.result
      items = {
        GRAFANA_ADMIN_PASSWORD = random_password.grafana_admin_password.result
      }
    }
  }
}

resource "null_resource" "vault_seed" {
  for_each = local.vault_item_groups

  triggers = {
    value = each.value.trigger
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST                 = var.docker_host
      NETWORK_NAME                = module.network_docker_apps.network_name
      VAULTWARDEN_CLIENT_ID       = var.vaultwarden_api_client_id
      VAULTWARDEN_CLIENT_SECRET   = var.vaultwarden_api_client_secret
      VAULTWARDEN_MASTER_PASSWORD = var.vaultwarden_account_master_password
      ITEMS_B64 = base64encode(join("\n", [
        for name, value in each.value.items : "${name}\t${base64encode(value)}"
      ]))
    }
    command = "${path.module}/scripts/seed_vault.sh"
  }

  depends_on = [module.compute_services_vaultwarden, module.network_docker_apps, null_resource.postgres_password_sync, null_resource.registry_restart]
}
