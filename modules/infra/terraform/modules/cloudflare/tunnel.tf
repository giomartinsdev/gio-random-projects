# The tunnel itself was created once by hand (`cloudflared tunnel
# create`, see modules/infra/terraform-bootstrap's own README) and is imported
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
# modules/infra/terraform-bootstrap/README.md) — local config always
# wins over remote when both exist, cloudflared never merges them.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "homelab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.homelab.id

  config = {
    ingress = concat(
      [for r in var.ingress_rules : {
        hostname = r.hostname
        service  = r.service
        origin_request = {
          # The actual, upstream-documented fix for the HTTP/2->1.1
          # translation quirk this repo worked around twice already
          # (modules/infra/terraform-bootstrap/docker-api-proxy,
          # modules/infra/terraform-bootstrap/beszel-proxy): cloudflared
          # itself was adding Transfer-Encoding: chunked to requests
          # that reached it without one, which dockerd rejects outright
          # on lifecycle calls and which PocketBase (Beszel's own base)
          # was misreading as a malformed request on
          # POST /api/collections/users/auth-refresh — see
          # https://github.com/henrygd/beszel/issues/878 and the
          # linked https://github.com/pocketbase/pocketbase/discussions/6663.
          # Confirmed live: this alone fixes Beszel's login without
          # beszel-proxy in the path at all. Applies to every hostname,
          # not just beszel.giomartins.dev — the same root cause
          # affects any of them proxying to a local origin.
          disable_chunked_encoding = true
        }
      }],
      [{ service = "http_status:404" }], # catch-all — must be last
    )
  }
}
