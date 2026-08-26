output "registry_host" {
  description = "Container name registry listens under — pair it with locals.tf's registry.giomartins.dev entry for the public address; nothing internal needs to reach this by container name today since it isn't on the apps network."
  value       = docker_container.registry.name
}
