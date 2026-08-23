# infra/cloudflared/config.yml is already the source of truth for what
# hostnames exist on this homelab (see that file's own header comment).
# Reading it here — instead of duplicating the hostname list as a
# second variable — means a hostname added there automatically gets a
# DNS record (dns.tf) and a Cloudflare Access application (access.tf)
# the next time this applies, with nothing else to remember.
# var.excluded_hostnames opts a hostname out of Access only — every
# hostname still gets DNS, protected or not.
locals {
  cloudflared_config = yamldecode(file("${path.module}/../cloudflared/config.yml"))

  all_hostnames = [
    for entry in local.cloudflared_config.ingress : entry.hostname
    if try(entry.hostname, null) != null
  ]

  protected_hostnames = toset([
    for h in local.all_hostnames : h
    if !contains(var.excluded_hostnames, h)
  ])
}
