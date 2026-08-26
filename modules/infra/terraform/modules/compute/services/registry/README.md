# module "compute/registry"

CI's own Docker registry plus the pull-based redeploy mechanism that
watches it — the deploy pipeline, not the app or its data stores. No
dependency on `compute/data` or `compute/app`; those depend on this
one only implicitly, by pulling images `go-ci-cd.yml`/`ts-ci-cd.yml`
push here.

- **`registry`** — `registry:2`, htpasswd-gated (`registry_user`/
  `registry_password`), plain HTTP on port 5000 (Phase 1 — see
  `modules/infra/terraform/README.md`). `htpasswd_init` is a one-shot
  container (`must_run = false`, `attach = true`) that bcrypts the
  password into a file on the `registry_auth` volume before `registry`
  starts. `registry_data` holds the actual pushed image blobs; both
  volumes are born fresh on the VPS.
- **`watchtower`** — polls `registry` and redeploys any container
  labeled `com.centurylinklabs.watchtower.enable=true`. Needs the
  host's own `/var/run/docker.sock` and `/root/.docker/config.json`
  (bind-mounted) — the latter is Terraform-managed now too
  (`docker_config_install` below), so this no longer depends on a
  `docker login registry.giomartins.dev:5000` run by hand.
- **`docker_config_install`** — one-shot (`must_run = false`,
  `attach = true`), writes the VPS's own `/root/.docker/config.json`
  with `registry_user`/`registry_password` base64-encoded into it,
  keyed by `registry.giomartins.dev:5000` — the same file a manual
  `docker login registry.giomartins.dev:5000` on the host would
  produce.

While unproxied (Phase 1), registry.giomartins.dev:5000 is plain HTTP
and reached directly — any client talking to it (this module's own
containers, or a CI runner in `go-ci-cd.yml`/`ts-ci-cd.yml`) needs its
own dockerd configured with `"insecure-registries":
["registry.giomartins.dev:5000"]`, since Docker refuses plain HTTP
registries by default. `modules/cloud/cloudflare/registry_mtls.tf`
generates a client certificate for a future Phase 2 (proxied, mTLS
enforced at the edge) — dormant today, nothing here consumes it.

`registry_password` stays a real input (`var.registry_password`, root
`variables.tf`) — unlike the other secrets in root `secrets.tf`, it
can't be a `random_password` resource, because the root docker
provider itself (`versions.tf`) also needs it for `registry_auth`, and
a provider configuration can't depend on a resource value computed in
the same apply (would be unknown on the very first transition apply).

Everything else about it IS automated: root `secrets.tf`'s
`null_resource.registry_restart` explicitly restarts `registry`/
`watchtower` whenever it changes (neither container references the
password itself, so nothing else would make them pick up the
rewritten htpasswd/config.json files), and it's pushed into
Vaultwarden as a `REGISTRY_PASSWORD` item (`scripts/seed_vault.sh`).

One piece stays manual regardless: `go-ci-cd.yml`/`ts-ci-cd.yml`'s own
`docker/login-action` push step reads a static `REGISTRY_PASSWORD` GH
secret, which has to be updated by hand to match after a rotation (no
PAT with `secrets:write` exists here to automate that from within CI).
