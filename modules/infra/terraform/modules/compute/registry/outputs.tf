output "registry_host" {
  description = "Container name registry listens under — join it to the tunnel hostname (registry.giomartins.dev) for the public address; nothing internal needs to reach this by container name today since it isn't on the apps network."
  value       = docker_container.registry.name
}
