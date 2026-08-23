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
  algorithm = "ED25519"
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
  account_id   = var.account_id
  name         = "gio-homelab-registry-ca"
  ca           = true
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
  algorithm = "ED25519"
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
