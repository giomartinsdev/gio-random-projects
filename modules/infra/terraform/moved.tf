# One-time address migration for the onion-architecture module
# reorganization (see commit "refactor(terraform): onion architecture
# for infra modules"). That commit moved module source directories
# without moved{} blocks, which made `terraform plan` show every
# resource as destroy+create instead of a pure rename -- unsafe here
# because several of them (the Cloudflare Tunnel, its Access
# application/service token, the registry mTLS cert) are live,
# in-use, singly-named resources: Cloudflare refuses to delete a
# tunnel with active connections or a cert still in use, and
# destroying the "docker" Access application invalidates the very
# credentials this same CI job uses to reach the Docker host mid-run
# (see tf-ci-cd.yml's access-proxy step). These blocks tell Terraform
# the new addresses are the same real-world objects, so the next plan
# should show 0 to add / 0 to destroy from this refactor.
#
# Each module's internal resource names are unchanged (git mv only
# moved directories), so a module-level moved block covers everything
# inside it, except module.compute_data, which the refactor split into
# three separate modules -- those need per-resource moved blocks.

moved {
  from = module.cloudflare
  to   = module.cloud_cloudflare
}

moved {
  from = module.compute_data.docker_network.apps
  to   = module.network_docker_apps.docker_network.apps
}

moved {
  from = module.compute_data.docker_volume.postgres_data
  to   = module.storage_postgres.docker_volume.postgres_data
}

moved {
  from = module.compute_data.docker_container.postgres
  to   = module.storage_postgres.docker_container.postgres
}

moved {
  from = module.compute_data.docker_volume.redis_data
  to   = module.storage_redis.docker_volume.redis_data
}

moved {
  from = module.compute_data.docker_container.redis
  to   = module.storage_redis.docker_container.redis
}

moved {
  from = module.compute_minio
  to   = module.storage_minio
}

moved {
  from = module.compute_app
  to   = module.compute_apps_domain_api
}

moved {
  from = module.compute_post_api
  to   = module.compute_apps_post_api
}

moved {
  from = module.compute_bookclub_api
  to   = module.compute_apps_bookclub_api
}

moved {
  from = module.compute_front
  to   = module.compute_apps_front
}

moved {
  from = module.compute_registry
  to   = module.compute_services_registry
}

moved {
  from = module.compute_monitoring
  to   = module.compute_services_monitoring
}

moved {
  from = module.compute_ninerouter
  to   = module.compute_services_ai_proxy
}

moved {
  from = module.compute_vaultwarden
  to   = module.compute_services_vaultwarden
}

moved {
  from = module.compute_vaultwarden_bridge[0]
  to   = module.compute_services_vaultwarden_bridge[0]
}
