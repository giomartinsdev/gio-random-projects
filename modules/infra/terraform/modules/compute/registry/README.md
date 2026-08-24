# module "compute/registry"

CI's own Docker registry plus the pull-based redeploy mechanism that
watches it — the deploy pipeline, not the app or its data stores. No
dependency on `compute/data` or `compute/app`; those depend on this
one only implicitly, by pulling images `apps-deploy.yml` pushes here.

- **`registry`** — `registry:2`, htpasswd-gated (`registry_user`/
  `registry_password`). `htpasswd_init` is a one-shot container
  (`must_run = false`, `attach = true`) that bcrypts the password into
  a file on the `registry_auth` volume before `registry` starts.
  `registry_data` holds the actual pushed image blobs; both volumes
  reuse the exact names the pre-Terraform compose stack used, and the
  root module's `imports.tf` adopts them by name on first apply
  instead of starting empty (import blocks are root-module-only, so
  they can't live here alongside the resources they target).
- **`watchtower`** — polls `registry` and redeploys any container
  labeled `com.centurylinklabs.watchtower.enable=true`. Needs the
  host's own `/var/run/docker.sock` and `/root/.docker/config.json`
  (bind-mounted) — the latter is Terraform-managed now too
  (`docker_config_install` below), so this no longer depends on a
  `docker login registry.giomartins.dev` run by hand. Also depends on
  `registry_client_cert_install` below — registry.giomartins.dev
  requires mTLS now (see `modules/cloudflare/registry_mtls.tf`), and
  htpasswd alone isn't enough to get past the edge anymore.
- **`docker_config_install`** — one-shot (`must_run = false`,
  `attach = true`), writes gio-server's own
  `/root/.docker/config.json` with `registry_user`/`registry_password`
  base64-encoded into it — the same file a manual `docker login
  registry.giomartins.dev` on the host would produce. Same bind-mount
  pattern as `registry_client_cert_install`.
- **`registry_client_cert_install`** — one-shot (`must_run = false`,
  `attach = true`), writes `registry_client_cert_pem`/
  `registry_client_key_pem` (module.cloudflare's generated mTLS client
  identity) to `/etc/docker/certs.d/registry.giomartins.dev/` on
  gio-server — the exact path dockerd checks automatically for any
  connection it makes to that host, covering `watchtower`'s pulls and
  this module's own `registry` resource with no separate manual step.
  CI's own pushes (`apps-deploy.yml`, a different machine entirely)
  need the same cert installed separately — see that workflow.

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

One piece stays manual regardless: `apps-deploy.yml`'s own
`docker/login-action` push step reads a static `REGISTRY_PASSWORD` GH
secret, which has to be updated by hand to match after a rotation (no
PAT with `secrets:write` exists here to automate that from within CI).
