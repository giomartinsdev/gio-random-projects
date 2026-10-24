variable "docker_host" {
  description = "SSH connection string to the VPS dockerd (var.docker_host). Only used to run the privileged one-shot container that applies host-level settings -- the docker provider itself is configured at root."
  type        = string
}

variable "enabled" {
  description = "Apply the host baseline. Off means this is a no-op (the module still exists in state, just does nothing)."
  type        = bool
  default     = true
}

variable "interface" {
  description = "Host network interface to pin the MTU on. Empty skips the MTU step entirely (leave empty on a host whose MTU is managed elsewhere)."
  type        = string
  default     = "enp0s6"
}

variable "mtu" {
  description = <<-EOT
    MTU to set on `interface`. 1500 (standard Ethernet) is the correct
    value for a host on the public internet; Oracle images sometimes ship
    with 9000 (jumbo frames), which the internet path can't carry and
    which silently drops large packets (e.g. a WebRTC DTLS handshake).
    Written to a netplan drop-in so it survives reboot.
  EOT
  type        = number
  default     = 1500
}

variable "firewall_rules" {
  description = <<-EOT
    Inbound rules to ensure exist in the HOST's iptables, each
    "{proto} {port|first:last}". The Oracle Security List is a separate
    cloud layer nobody can edit from inside the VM -- these are the LOCAL
    iptables rules that sit in front of every published port, and without
    them a port can be open in the cloud and still unreachable. Idempotent:
    a rule already present is left alone; a missing one is inserted.
  EOT
  type        = list(string)
  default     = []
}
