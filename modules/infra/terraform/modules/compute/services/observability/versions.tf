# Provider CONFIGURATION lives only at the root (versions.tf there) —
# this module only declares what it needs and receives the configured
# instance via the module block's `providers = {}` in main.tf. See the
# root versions.tf's header for why this split is what keeps modules
# composable.

terraform {
  required_version = ">= 1.10"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}