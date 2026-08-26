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
(`modules/compute/services/*`). Phase 1 of the migration exposes each
service directly on its own port; flipping the DNS records to proxied
puts Cloudflare's edge (Access, WAF, mTLS) back in front without any
other change.
