# module "compute/post_api"

Deploys `modules/apps/post-api` — see that directory's own README for
what the service does and why it owns no post storage of its own
(everything goes through domain-api/domain-worker instead).

Shares `compute/data`'s Postgres instance (same `postgres_user`
database domain-api/worker use) rather than getting its own — Better
Auth's tables (`user`, `session`, `account`, `verification`, all
singular) don't collide with domain's (`users`, `posts`, `audit_log`).
`post_api_migrate` is a one-shot container that applies Better Auth's
Drizzle migrations before `post_api` starts, same pattern as
`compute/registry`'s `htpasswd_init`.

Reaches `domain-api` by container name (`http://domain-api:8000`) over
the shared docker network — a runtime dependency, not a Terraform
one, so this module doesn't need `compute_app` passed in directly.

`external_port` defaults to 8002 (not 8000 — already taken by
domain-api on the same host).
