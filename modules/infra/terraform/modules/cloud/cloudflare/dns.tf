# One A record per exposed hostname, pointing straight at the server.
#
# Phase 2 of the VPS migration is live: every record is orange-cloud
# (proxied) EXCEPT the ones in locals.tf's direct_hostnames — traffic
# to proxied hostnames transits Cloudflare's edge first: real TLS on
# 443 terminates there (no cert management on the VPS; ingress still
# speaks plain HTTP on origin :80), and the Access applications /
# service tokens / WAF ruleset this module manages start enforcing the
# moment traffic flows through. Nothing on the VPS changes.
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

  # Orange for everything behind ingress; grey only for hostnames whose
  # traffic can't transit Cloudflare's proxy at all (see locals.tf).
  proxied = !contains(local.direct_hostnames, each.value)

  # The API normalizes proxied records' TTL to 1 no matter what is sent,
  # so sending anything else is a permanent refresh-time diff. Only the
  # grey-cloud records get a real TTL.
  ttl = contains(local.direct_hostnames, each.value) ? 300 : 1
}
