# The zone's SSL/TLS mode decides which port Cloudflare's edge dials on
# the origin for proxied hostnames: "flexible" = origin :80 (plain HTTP
# behind the proxy), "full"/"strict" = origin :443 (needs a cert there).
# This homelab terminates TLS only at the edge — ingress speaks plain
# HTTP on :80 by design (see modules/compute/services/ingress) — so pin
# flexible. The leftover "full" from the old home-server setup (which
# had a real certificate at the origin) is what 521'd every proxied
# hostname the moment Phase 2's proxy flip went live.
#
# Future hardening, deliberately not now: a Cloudflare Origin CA
# certificate installed on ingress + mode "strict" would encrypt the
# edge→origin leg too. That needs an API token with Origin CA edit
# permission (this config's token doesn't have it) and an ingress :443
# listener — a migration of its own, not a setting flip.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.zone_id
  setting_id = "ssl"
  value      = "flexible"
}
