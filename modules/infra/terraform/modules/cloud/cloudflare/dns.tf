# One A record per exposed hostname, pointing straight at the server.
#
# Phase 1 of the VPS migration: proxied = false (grey cloud) — the
# names resolve to the machine itself and every service is reached on
# its own published port (http://IP:PORT), with nothing in front. This
# is also what keeps registry.giomartins.dev resolving for CI's docker
# push and the server's own pulls during and after the cutover.
#
# Phase 2 (later): flip proxied = true in one apply. The Access
# applications, WAF ruleset, and registry mTLS hostname association
# managed by this module stay configured the whole time — they simply
# start enforcing again the moment traffic flows through the proxy
# again. Nothing else changes.
#
# Plain for_each, deliberately: removing a hostname from var.hostnames
# removes it from this set, and Terraform destroys the orphaned record
# on the next apply — no separate prune step to remember or trigger.
resource "cloudflare_dns_record" "hostname" {
  for_each = toset(var.hostnames)

  zone_id = var.zone_id
  name    = each.value
  type    = "A"
  content = var.server_ip
  proxied = false
  ttl     = 300
}
