# The tunnel itself was created once by hand (`cloudflared tunnel
# create`, see modules/infra/cloudflared's own README) and is imported
# here, not created — a fresh cloudflare_zero_trust_tunnel_cloudflared
# would mint a new tunnel ID, which would orphan every DNS record above
# (they point at THIS tunnel's ID via its .cfargotunnel.com hostname)
# and require redistributing new credentials to the server.
resource "cloudflare_zero_trust_tunnel_cloudflared" "homelab" {
  account_id = var.account_id
  name       = var.tunnel_name
  # Deliberately not setting config_src: it's a forces-replacement
  # field in this provider (confirmed live — a plan to flip it from
  # "local" to "cloudflare" wanted to destroy and recreate the tunnel,
  # which would mint a new tunnel ID and break every DNS record and
  # the server's existing credentials). Pushing
  # cloudflare_zero_trust_tunnel_cloudflared_config below is what
  # actually flips a tunnel to remote-managed on Cloudflare's side;
  # this resource doesn't need to declare that itself.
}

# Pushes ingress rules to Cloudflare's control plane. The cloudflared
# process on gio-server picks this up automatically as long as it's
# NOT started with a --config flag (see
# modules/infra/cloudflared/README.md) — local config always wins over
# remote when both exist, cloudflared never merges them.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "homelab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.homelab.id

  config = {
    ingress = concat(
      [for r in var.ingress_rules : { hostname = r.hostname, service = r.service }],
      [{ service = "http_status:404" }], # catch-all — must be last
    )
  }
}
