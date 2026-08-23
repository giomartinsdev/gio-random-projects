# Import blocks are root-module-only, so these live here even though
# the resources themselves belong to module.compute_registry. Adopts
# the volumes the pre-Terraform compose stack created (see that
# module's main.tf for the docker_volume names) instead of erroring on
# "already exists" or, worse, silently creating empty ones that shadow
# the real data. Containers aren't imported — registry_password
# rotated as part of this cutover either way, so they're meant to be
# recreated fresh on compute_registry's first apply; only the data in
# these two volumes needs to survive.
import {
  to = module.compute_registry.docker_volume.registry_data
  id = "registry_registry-data"
}

import {
  to = module.compute_registry.docker_volume.registry_auth
  id = "registry_registry-auth"
}
