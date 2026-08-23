variable "network_name" {
  description = "Docker network to join — reused from compute/data's output so the hub can reach the agent by container name, not created here."
  type        = string
}

variable "hub_image_tag" {
  description = "henrygd/beszel:<tag>."
  type        = string
  default     = "latest"
}

variable "agent_image_tag" {
  description = "henrygd/beszel-agent:<tag>."
  type        = string
  default     = "latest"
}

variable "agent_key" {
  description = <<-EOT
    The hub's SSH public key, authorizing it to connect to this agent.
    Can't be known before the hub's first boot (it generates its own
    keypair into its data volume on startup) — leave "" for the first
    apply, then after the hub is up: Settings -> the key is shown when
    adding a system, or read it directly from the hub's data volume
    (see README.md). Set it here and re-apply once you have it — until
    then the agent is up and listening but the hub has nothing to
    authenticate it with, so no metrics actually flow.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}
