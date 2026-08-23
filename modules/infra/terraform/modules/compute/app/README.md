# module "compute/app"

The stateless half of the apps stack: `docker_container.domain_api`
and `docker_container.domain_worker`, pulling
`registry.giomartins.dev/{domain-api,domain-worker}:latest` — the
`domain` bounded context's pair; more `<bounded-context>-api`/
`<bounded-context>-worker` pairs get their own resources here as they
show up. Depends on `compute/data`'s outputs to join the same network
and reach postgres/redis by hostname — never creates its own network
or volumes.

`modules/infra/terraform/modules/compute/registry`'s watchtower polls
the registry and redeploys these two whenever CI pushes a new image;
this module is what defines they exist with the right
image/env/network in the first place and repairs drift. Set
`watchtower_enabled = false` to opt a deployment out of that (e.g. a
one-off manual environment).
