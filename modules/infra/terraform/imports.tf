# Import blocks are root-module-only, so these live here even though
# the resources themselves belong to module.compute_registry. Adopts
# the volumes the pre-Terraform compose stack created (see that
# module's main.tf for the docker_volume names) instead of erroring on
# "already exists" or, worse, silently creating empty ones that shadow
# the real data. Containers aren't imported — registry_password
# rotated as part of this cutover either way, so they're meant to be
# recreated fresh on compute_registry's first apply; only the data in
# these two volumes needs to survive.
import {
  to = module.compute_registry.docker_volume.registry_data
  id = "registry_registry-data"
}

import {
  to = module.compute_registry.docker_volume.registry_auth
  id = "registry_registry-auth"
}

# Every zone already has one (empty, Cloudflare-created) entry-point
# ruleset per phase — cloudflare_ruleset can't just "create" one for
# http_request_firewall_custom, since a zone can only have one and
# this zone already does (confirmed live: apply errored "exceeded
# maximum number of zone rulesets for phase
# http_request_firewall_custom"). Looked up by phase here (root-only,
# same reason as the volume imports above) rather than hardcoding an
# ID, since it's account data this config didn't create and has no
# other record of.
data "cloudflare_rulesets" "zone" {
  zone_id = var.cloudflare_zone_id
}

locals {
  existing_custom_waf_ruleset_id = one([
    for r in data.cloudflare_rulesets.zone.rulesets : r.id
    if r.phase == "http_request_firewall_custom"
  ])
}

import {
  to = module.cloudflare.cloudflare_ruleset.registry_mtls_enforce
  id = "zones/${var.cloudflare_zone_id}/${local.existing_custom_waf_ruleset_id}"
}

# The ED25519->ECDSA switch's create_before_destroy left orphans: each
# failed apply attempt created a new (ECDSA) cert successfully before
# failing on a later step (deleting the old cert, which Cloudflare
# briefly still considered "in use"), so Terraform never recorded any
# of them in state — repeated retries left several orphans, all with
# DIFFERENT random key material (tls_private_key regenerated fresh
# each time state didn't retain the previous attempt), so only one
# actually matches what THIS apply's own (already-stable-in-state)
# tls_self_signed_cert.registry_ca holds. Matches by content
# (module.cloudflare's own registry_ca_cert_pem output) rather than
# picking an index or excluding one known ID — picking wrong just
# reproduces the same "already exists" error against a DIFFERENT
# orphan. The non-matching orphans are harmless unused clutter,
# cleaned up by hand later. Delete this whole block once the import
# has been applied.
data "cloudflare_mtls_certificates" "account" {
  account_id = var.cloudflare_account_id
}

locals {
  registry_ca_orphaned_id = one([
    for c in data.cloudflare_mtls_certificates.account.result : c.id
    if c.ca && c.certificates == module.cloudflare.registry_ca_cert_pem
  ])
}

import {
  to = module.cloudflare.cloudflare_mtls_certificate.registry_ca
  id = local.registry_ca_orphaned_id
}
