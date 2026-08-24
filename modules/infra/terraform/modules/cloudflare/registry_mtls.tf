# registry.giomartins.dev's second layer, on top of the registry's own
# htpasswd auth — but NOT a Cloudflare Access application like
# service_token_access.tf's hostnames: Docker's push/pull tooling
# can't send custom headers (no way to attach
# CF-Access-Client-Id/Secret to a `docker push`), so an Access
# application (any decision type) would just break every push and
# every watchtower pull. mTLS sidesteps this entirely — Docker natively
# supports presenting a client certificate per-registry via
# /etc/docker/certs.d/<host>/{client.cert,client.key}, validated by
# Cloudflare at the TLS handshake itself, before any HTTP request
# (redirect-based or otherwise) is even possible. No proxy, no header
# injection, no CI-side workaround needed anywhere this cert is
# installed.
#
# The CA below is generated here and only here — Cloudflare just needs
# its public certificate to know what to trust; the private key never
# leaves this state. Anyone holding the issued client certificate/key
# (registry_client_cert_pem/registry_client_key_pem, see outputs.tf)
# can push and pull; treat them like the registry password they sit
# alongside.
resource "tls_private_key" "registry_ca" {
  # NOT ED25519: Cloudflare's BYO-CA mTLS only accepts RSA or ECDSA
  # signatures (confirmed against their docs after an ED25519 CA here
  # got silently accepted by `cloudflare_mtls_certificate` but every
  # request's cf.tls_client_auth.cert_verified evaluated false anyway,
  # even presenting a cert this same CA had signed).
  #
  # Deliberately NOT create_before_destroy: Cloudflare refuses to
  # delete a CA cert still referenced by a hostname association
  # ("Certificate cannot be deleted while in use"), and CBD's
  # create-new-first ordering runs straight into that — the old cert
  # is still in use by definition until the new one takes over.
  # Destroy-then-create means a real gap (registry.giomartins.dev
  # rejects everyone, including watchtower and CI, until the new cert
  # + association land later in the same apply) — acceptable since
  # nothing needs zero-downtime here and it's over in one apply.
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "registry_ca" {
  private_key_pem       = tls_private_key.registry_ca.private_key_pem
  is_ca_certificate     = true
  validity_period_hours = 87600 # 10 years — rotating this drops every issued client cert

  subject {
    common_name  = "gio-homelab registry mTLS CA"
    organization = "gio-homelab"
  }

  allowed_uses = [
    "cert_signing",
    "crl_signing",
  ]
}

resource "cloudflare_mtls_certificate" "registry_ca" {
  account_id = var.account_id
  ca         = true
  # Cloudflare always echoes back a `name` (empty string "" if none was
  # given at upload) — `name` is ForceNew, so leaving it unset (null in
  # our config) against a refreshed "" from the API is a permanent
  # diff that forces replacement on every single plan, forever.
  # Confirmed live: this is what caused a supposedly-clean apply right
  # after a successful one to try to destroy/recreate this cert again.
  name         = "gio-homelab-registry-mtls-ca"
  certificates = tls_self_signed_cert.registry_ca.cert_pem
}

resource "cloudflare_certificate_authorities_hostname_associations" "registry" {
  zone_id             = var.zone_id
  hostnames           = ["registry.giomartins.dev"]
  mtls_certificate_id = cloudflare_mtls_certificate.registry_ca.id
}

# The single client identity every puller/pusher shares (CI and
# watchtower alike) — Cloudflare's mTLS hostname association doesn't
# distinguish between client certificates the way Access service
# tokens distinguish between callers, so there's no isolation benefit
# to issuing more than one.
resource "tls_private_key" "registry_client" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "registry_client" {
  private_key_pem = tls_private_key.registry_client.private_key_pem

  subject {
    common_name  = "registry.giomartins.dev client"
    organization = "gio-homelab"
  }
}

resource "tls_locally_signed_cert" "registry_client" {
  cert_request_pem      = tls_cert_request.registry_client.cert_request_pem
  ca_private_key_pem    = tls_private_key.registry_ca.private_key_pem
  ca_cert_pem           = tls_self_signed_cert.registry_ca.cert_pem
  validity_period_hours = 87600

  allowed_uses = [
    "client_auth",
  ]
}

# Associating a CA with a hostname (above) only makes Cloudflare
# validate a client certificate IF one is presented — it does NOT by
# itself reject requests that present none. Confirmed live: a plain
# `curl` with no client cert reached the registry's own htpasswd
# check and got a normal 401 from that, not blocked at the edge at
# all. This WAF custom rule is the actual enforcement Cloudflare's own
# docs point to ("Enforce mTLS with a WAF custom rule") — mTLS is
# genuinely optional without it.
resource "cloudflare_ruleset" "registry_mtls_enforce" {
  zone_id     = var.zone_id
  name        = "registry.giomartins.dev mTLS enforcement"
  description = "Blocks any request to registry.giomartins.dev that didn't present a client certificate signed by cloudflare_mtls_certificate.registry_ca."
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules = [{
    action      = "block"
    expression  = "(http.host eq \"registry.giomartins.dev\" and not cf.tls_client_auth.cert_verified)"
    description = "Require registry mTLS client cert"
    enabled     = true
  }]
}
