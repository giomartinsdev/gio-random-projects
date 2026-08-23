output "hub_container_name" {
  value = docker_container.beszel_hub.name
}

output "agent_container_name" {
  value = docker_container.beszel_agent.name
}
