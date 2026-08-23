# module "compute/app"

The stateless half of the apps stack: `docker_container.api` and
`docker_container.worker`, pulling `registry.giomartins.dev/{api,worker}:latest`.
Depends on `compute/data`'s outputs to join the same network and reach
postgres/redis by hostname — never creates its own network or volumes.

`modules/infra/watchtower` polls the registry and redeploys these two
whenever CI pushes a new image; this module is what defines they exist
with the right image/env/network in the first place and repairs drift.
Set `watchtower_enabled = false` to opt a deployment out of that (e.g.
a one-off manual environment).
