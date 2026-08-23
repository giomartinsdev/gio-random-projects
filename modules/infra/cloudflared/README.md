# Cloudflare Tunnel — gio-server

Remote-managed: ingress rules live in Cloudflare's control plane, pushed by
`modules/infra/terraform/modules/cloudflare`'s
`cloudflare_zero_trust_tunnel_cloudflared_config` resource (driven by
the root module's `locals.tf`'s `ingress_rules`) — not a local file.
The container itself runs via `modules/infra/terraform-tunnel`, with
`--credentials-file`, no `--config`, so it always fetches whatever
Terraform last pushed. Only the credentials (`creds.json`, `cert.pem`)
live in this folder now — no compose file; see
`modules/infra/terraform-tunnel`'s README for why the container
definition had to move out of a plain compose file and into its own
deliberately-isolated Terraform config.

## One-time setup (on the server)

```bash
# 1. Install cloudflared CLI (if not already present)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# 2. Authenticate — opens a browser link, pick the giomartins.dev zone
cloudflared tunnel login

# 3. Create the tunnel (writes ~/.cloudflared/<UUID>.json)
cloudflared tunnel create gio-server

# 4. Copy the generated credentials file into this folder as creds.json
cp ~/.cloudflared/<UUID>.json modules/infra/cloudflared/creds.json
```

Bringing the tunnel container up from here on is
`modules/infra/terraform-tunnel`'s job — see that directory's README.
DNS and ingress routing are handled entirely by
`modules/infra/terraform` — see that directory's README, not this
one, for adding a new service.

## Notes

- `creds.json` and `cert.pem` are gitignored — treat them as secrets, back them
  up outside of git (password manager / secrets vault).
- If `modules/infra/terraform` is ever unreachable and the tunnel needs an emergency
  local config, `cloudflared tunnel --config <file> run` still works — a
  `--config` flag always wins over remote config when both are available.
