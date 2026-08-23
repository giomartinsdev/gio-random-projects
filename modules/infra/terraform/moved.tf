# Records the flat -> modular refactor so `terraform apply` updates
# resource addresses in state instead of destroying and recreating
# live infrastructure (DNS records, Access apps, the tunnel, and
# especially the docker_containers — postgres holds real data). Safe
# to delete once everyone's state has picked these up, but there's no
# harm in leaving them.
moved {
  from = cloudflare_dns_record.tunnel_hostname
  to   = module.cloudflare.cloudflare_dns_record.tunnel_hostname
}

moved {
  from = cloudflare_zero_trust_access_policy.google_sso
  to   = module.cloudflare.cloudflare_zero_trust_access_policy.google_sso
}

moved {
  from = cloudflare_zero_trust_access_application.protected
  to   = module.cloudflare.cloudflare_zero_trust_access_application.protected
}

moved {
  from = cloudflare_zero_trust_tunnel_cloudflared.homelab
  to   = module.cloudflare.cloudflare_zero_trust_tunnel_cloudflared.homelab
}

moved {
  from = cloudflare_zero_trust_tunnel_cloudflared_config.homelab
  to   = module.cloudflare.cloudflare_zero_trust_tunnel_cloudflared_config.homelab
}

moved {
  from = cloudflare_zero_trust_access_service_token.ci_docker
  to   = module.cloudflare.cloudflare_zero_trust_access_service_token.ci_docker
}

moved {
  from = cloudflare_zero_trust_access_policy.docker_service_token
  to   = module.cloudflare.cloudflare_zero_trust_access_policy.docker_service_token
}

moved {
  from = cloudflare_zero_trust_access_application.docker
  to   = module.cloudflare.cloudflare_zero_trust_access_application.docker
}

moved {
  from = docker_network.apps
  to   = module.compute_data.docker_network.apps
}

moved {
  from = docker_volume.postgres_data
  to   = module.compute_data.docker_volume.postgres_data
}

moved {
  from = docker_volume.redis_data
  to   = module.compute_data.docker_volume.redis_data
}

moved {
  from = docker_container.postgres
  to   = module.compute_data.docker_container.postgres
}

moved {
  from = docker_container.redis
  to   = module.compute_data.docker_container.redis
}

moved {
  from = docker_container.api
  to   = module.compute_app.docker_container.api
}

moved {
  from = docker_container.worker
  to   = module.compute_app.docker_container.worker
}
