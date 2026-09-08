locals {
  # Hostnames that must stay grey-cloud because their traffic can't go
  # through Cloudflare's proxy at all: docker's push/pull tooling talks
  # plain HTTP to registry.giomartins.dev:5000 (CI's `docker push`,
  # watchtower's pulls), and 5000 isn't a port Cloudflare proxies — an
  # orange record would resolve those clients to Cloudflare's edge IPs,
  # where :5000 doesn't exist, breaking every deploy. The registry keeps
  # its own htpasswd auth; the mTLS machinery in registry_mtls.tf stays
  # dormant for as long as this record is grey (it only ever fires on
  # traffic that actually transits the proxy). Everything else rides
  # ingress on :80 behind Cloudflare.
  direct_hostnames = toset([
    "registry.giomartins.dev",
  ])

  # Everything Access-protected: full hostnames minus the excluded
  # ones, plus any single paths that are protected even though their
  # bare hostname is public (path_protected_hostnames -- same
  # policies/service tokens/applications, keyed by the host+path
  # string; DNS only ever keys on the bare hostnames above).
  protected_hostnames = toset(concat(
    [for h in var.hostnames : h if !contains(var.excluded_hostnames, h)],
    var.path_protected_hostnames,
  ))
}
