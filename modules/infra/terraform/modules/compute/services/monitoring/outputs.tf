output "hub_container_name" {
  value = docker_container.beszel_hub.name
}

output "agent_container_name" {
  description = "null until agent_key is set and the agent resource actually exists — see main.tf's count."
  value       = one(docker_container.beszel_agent[*].name)
}
