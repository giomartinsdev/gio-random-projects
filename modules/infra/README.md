# modules/infra

Two Terraform configs, nothing else:

- **`terraform/`** — source of truth for Cloudflare (DNS, Zero Trust
  Access, registry mTLS) **and** the VPS's core containers (postgres,
  redis, minio, the APIs, the front, registry, watchtower — all via
  the `docker` provider over SSH). Deployed by
  `.github/workflows/tf-ci-cd.yml`. See its own README for the full
  picture.
- **`terraform-bootstrap/`** — what `terraform/` can't manage itself
  because it's what makes that config work in the first place: the R2
  bucket its state lives in. Applied by hand only, never CI, with
  local state — see its own README for why.

## Currently deployed on the VPS

Everything `terraform/` manages: `postgres`/`redis`/`minio`
(`modules/storage/*`), the app containers (`modules/compute/apps/*`),
and `registry`/`watchtower` + the service containers
(`modules/compute/services/*`) — including the Grafana observability
stack (`modules/compute/services/observability`), which every app ships
its traces/metrics to and whose alloy tails every container's stdout
into Loki. Phase 2 of the migration is live:
every hostname is orange-cloud through Cloudflare, so the edge
(Access, TLS) sits back in front — except registry.giomartins.dev,
which stays grey-cloud because its :5000 docker protocol can't transit
the proxy.
