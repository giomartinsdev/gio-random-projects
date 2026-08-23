# Replaces the old .github/scripts/sync_cloudflare_dns.py +
# dns-sync.yml/dns-prune.yml pair — those only ever upserted (never
# deleted) a record for whatever was in config.yml at push time, which
# is why a stale CNAME needed a separate manual prune workflow at all.
# A plain for_each resource doesn't have that gap: removing a hostname
# from config.yml removes it from this set, and Terraform destroys the
# orphaned record on the next apply — no separate prune step to remember
# or trigger.
resource "cloudflare_dns_record" "tunnel_hostname" {
  for_each = toset(local.all_hostnames)

  zone_id = var.cloudflare_zone_id
  name    = each.value
  type    = "CNAME"
  content = "${var.cloudflare_tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # "Auto" — required by the API when proxied is true
}
