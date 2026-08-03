# Cloudflare Tunnel — gio-server

Locally-managed tunnel: ingress rules live in `config.yml` (versioned), credentials
are generated per-machine and never committed.

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

# 5. Point the hostname(s) in config.yml at the tunnel (creates the DNS CNAME)
cloudflared tunnel route dns gio-server openship.giomartins.dev

# 6. Bring the tunnel up
cd infra/cloudflared
docker compose up -d
```

## Adding a new service later

1. Add a block to `config.yml` above the `http_status:404` catch-all:
   ```yaml
   - hostname: newservice.giomartins.dev
     service: http://localhost:PORT
   ```
2. Route the DNS record: `cloudflared tunnel route dns gio-server newservice.giomartins.dev`
3. Restart: `docker compose restart cloudflared`

## Notes

- `network_mode: host` is required so `localhost:PORT` in `config.yml` reaches
  services published on the host by other docker-compose stacks.
- `creds.json` and `cert.pem` are gitignored — treat them as secrets, back them
  up outside of git (password manager / secrets vault).
