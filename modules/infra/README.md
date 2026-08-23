# modules/infra

- **`terraform/`** — source of truth for everything Cloudflare: DNS,
  Zero Trust Access, and the tunnel's own ingress routing, all driven
  from `locals.tf`'s `ingress_rules`. Deployed by
  `.github/workflows/tf-deploy.yml`.
- **`terraform-bootstrap/`** — creates the R2 bucket `terraform/`'s
  state lives in. One-time, by hand, local state — see its own README.
- **`cloudflared/`** — the tunnel container itself. Remote-managed (no
  local ingress config — `terraform/tunnel.tf` pushes that); this
  folder is just `docker-compose.yml` plus the gitignored credentials.
- **`watchtower/`** — polls `registry.giomartins.dev` and redeploys any
  container labeled for it. The pull-based half of
  `.github/workflows/apps-deploy.yml`'s CD — gio-server has no inbound
  access a push-based deploy could use.
- **`registry/`** — this repo's own Docker registry, htpasswd-gated.
  `apps-deploy.yml` pushes here; `watchtower/` pulls from here.
  Requires `REGISTRY_PASSWORD` in its `.env` — no default.

## Currently deployed on gio-server

`cloudflared`, `watchtower`, `registry`, and whatever `modules/apps/*`
images Watchtower has pulled (`~/apps/apps` on the server — see
`modules/apps/README.md`).
