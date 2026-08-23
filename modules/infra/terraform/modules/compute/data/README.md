# module "compute/data"

The stateful half of the apps stack: `docker_network`, two
`docker_volume`s, and the `postgres`/`redis` `docker_container`s.
Separate from `compute/app` so the two can be reasoned about (and
changed) independently — this is what holds real data.

`compute/app` depends on this module's outputs (`network_name`,
`postgres_host`, `redis_host`) to join the same network and reach
these two by hostname.
