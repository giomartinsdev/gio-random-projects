# modules/infra

- **`terraform/`** — source of truth for Cloudflare (DNS, Zero Trust
  Access, tunnel routing) **and** gio-server's core containers
  (postgres, redis, api, worker, registry, watchtower — all via the
  `docker` provider). Deployed by `.github/workflows/tf-deploy.yml`.
  See its own README for the full picture.
- **`terraform-bootstrap/`** — creates the R2 bucket `terraform/`'s
  (and `terraform-tunnel/`'s) state lives in. One-time, by hand, local
  state — see its own README.
- **`terraform-tunnel/`** — manages `cloudflared` and `docker-api-proxy`,
  the two containers `terraform/`'s own `docker` provider connects
  *through* to reach dockerd. Deliberately separate and applied by
  hand (never CI) — its `docker` provider connects to dockerd directly
  over an SSH port-forward instead, so it isn't cutting its own
  connection when it recreates either container. See its own README.
- **`cloudflared/`** — just the tunnel's gitignored credentials
  (`creds.json`, `cert.pem`) now; `terraform-tunnel/` runs the
  container.
- **`docker-api-proxy/`** — `Dockerfile` and `proxy.py`, the Docker
  build context `terraform-tunnel/` builds and runs; see that
  directory's README for the Cloudflare Tunnel quirk `proxy.py` works
  around.

`watchtower/` and `registry/` (the pre-Terraform compose stacks for
both) are gone — see `terraform/modules/compute/registry`, which
replaced them.

## Currently deployed on gio-server

`cloudflared` and `docker-api-proxy` (via `terraform-tunnel/`), and
everything `terraform/` manages: `postgres`/`redis`
(`modules/compute/data`), `api`/`worker` (`modules/compute/app`),
`registry`/`watchtower` (`modules/compute/registry`).
