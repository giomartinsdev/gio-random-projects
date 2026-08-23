# Adopts the volumes the pre-Terraform compose stack created (see
# main.tf's docker_volume names) instead of erroring on "already
# exists" or, worse, silently creating empty ones that shadow the real
# data. Containers aren't imported — registry_password is new either
# way, so they're meant to be recreated fresh on this module's first
# apply; only the data in these two volumes needs to survive.
import {
  to = docker_volume.registry_data
  id = "registry_registry-data"
}

import {
  to = docker_volume.registry_auth
  id = "registry_registry-auth"
}
