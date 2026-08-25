# module "compute/adminer"

Ad-hoc, read-and-write access to production Postgres, for a human,
without exposing Postgres itself to anything. [Adminer](https://www.adminer.org/)
is a single-file PHP admin GUI (browse tables, run raw SQL, export
data) — one container, no database credentials of its own baked in
anywhere.

- **`adminer`** — `adminer:latest`, stateless (no volume). Published
  on `var.published_port` (default `8092`); the root module's
  `locals.tf` ingress rule for `adminer.giomartins.dev` must point at
  the same port. Joins `var.network_name` (the same `apps` network
  `postgres` is on) so it can reach that container by name.

## Access — two independent layers, neither of them Terraform state

1. **Cloudflare Access (Google SSO).** `adminer.giomartins.dev` is not
   in `excluded_hostnames`, so it gets the same Access application
   every other browser-facing hostname does (beszel, vault, minio) —
   reaching Adminer's login page at all requires a
   `var.allowed_emails` Google account first. This is the only auth
   boundary this module itself sets up.
2. **Adminer's own login form.** Server/username/password/database,
   typed in fresh on every visit — Adminer never stores or caches
   them server-side. Nothing DB-related lives in this module's
   Terraform state; there is no `postgres_password` variable here to
   set.

## Logging in

1. Visit `https://adminer.giomartins.dev`, authenticate through
   Cloudflare Access.
2. On Adminer's own login form:
   - **System**: PostgreSQL
   - **Server**: `postgres` (the container name — reachable because
     both containers share `var.network_name`)
   - **Username** / **Database**: `var.postgres_user` from
     `module.storage_postgres` (default `domain`)
   - **Password**: the real value of `random_password.postgres`
     (root `main.tf`) — pull it from Terraform state
     (`terraform output` if it's exposed, or `terraform state show
     random_password.postgres`), not from anything in this repo.

## Why this instead of exposing Postgres directly

No ingress rule for Postgres exists anywhere in this repo, and this
module doesn't add one — port 5432 stays reachable only by other
containers on `var.network_name`. Adminer is the entire "how do I run
a query against prod" story: one more browser-facing hostname behind
the same Access gate as everything else, not a new hole in the
network boundary.
