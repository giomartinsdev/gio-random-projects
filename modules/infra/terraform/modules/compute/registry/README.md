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
  (bind-mounted, not Terraform-managed) — the latter must already hold
  registry credentials via a `docker login registry.giomartins.dev`
  run by hand on the host with the same `registry_user`/
  `registry_password` this module sets, or watchtower's pulls will
  fail auth even though the registry itself is reachable. Also depends
  on `registry_client_cert_install` below — registry.giomartins.dev
  requires mTLS now (see `modules/cloudflare/registry_mtls.tf`), and
  htpasswd alone isn't enough to get past the edge anymore.
- **`registry_client_cert_install`** — one-shot (`must_run = false`,
  `attach = true`), writes `registry_client_cert_pem`/
  `registry_client_key_pem` (module.cloudflare's generated mTLS client
  identity) to `/etc/docker/certs.d/registry.giomartins.dev/` on
  gio-server — the exact path dockerd checks automatically for any
  connection it makes to that host, covering `watchtower`'s pulls and
  this module's own `registry` resource with no separate manual step.
  CI's own pushes (`apps-deploy.yml`, a different machine entirely)
  need the same cert installed separately — see that workflow.

Changing `registry_password` only recreates `htpasswd_init` (and
therefore rewrites the auth file) — it does not by itself restart
`registry` or `watchtower`, and does not update the host's
`config.json`. Rotate all three together by hand when changing it, the
same way the root README's secrets table expects.
