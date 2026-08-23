# Cloudflare Tunnel — gio-server

Remote-managed: ingress rules live in Cloudflare's control plane, pushed by
`infra/terraform` (`tunnel.tf`'s `cloudflare_zero_trust_tunnel_cloudflared_config`,
driven by `locals.tf`'s `ingress_rules`) — not a local file. `docker-compose.yml`
runs `cloudflared` with `--credentials-file`, no `--config`, so it always fetches
whatever Terraform last pushed. Only the credentials (`creds.json`) live here.

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
cp ~/.cloudflared/<UUID>.json infra/cloudflared/creds.json

# 5. Bring the tunnel up
cd infra/cloudflared
docker compose up -d
```

DNS and ingress routing are handled entirely by `infra/terraform` after
this — see that directory's README, not this one, for adding a new
service.

## Notes

- `network_mode: host` is required so `localhost:PORT` in the ingress config
  (see `infra/terraform/locals.tf`) reaches services published on the host by
  other docker-compose stacks.
- `creds.json` and `cert.pem` are gitignored — treat them as secrets, back them
  up outside of git (password manager / secrets vault).
- If `infra/terraform` is ever unreachable and the tunnel needs an emergency
  local config, `cloudflared tunnel --config <file> run` still works — a
  `--config` flag always wins over remote config when both are available.
