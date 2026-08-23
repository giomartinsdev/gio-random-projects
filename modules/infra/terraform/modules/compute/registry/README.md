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
  reuse the exact names the pre-Terraform compose stack used so this
  module's first apply adopts the existing data instead of starting
  empty.
- **`watchtower`** — polls `registry` and redeploys any container
  labeled `com.centurylinklabs.watchtower.enable=true`. Needs the
  host's own `/var/run/docker.sock` and `/root/.docker/config.json`
  (bind-mounted, not Terraform-managed) — the latter must already hold
  registry credentials via a `docker login registry.giomartins.dev`
  run by hand on the host with the same `registry_user`/
  `registry_password` this module sets, or watchtower's pulls will
  fail auth even though the registry itself is reachable.

Changing `registry_password` only recreates `htpasswd_init` (and
therefore rewrites the auth file) — it does not by itself restart
`registry` or `watchtower`, and does not update the host's
`config.json`. Rotate all three together by hand when changing it, the
same way the root README's secrets table expects.
