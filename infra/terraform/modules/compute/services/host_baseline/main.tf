# Host-level baseline the Docker provider can't express: the MTU on the
# VPS's NIC and the LOCAL iptables rules in front of every published port.
#
# Why this is a module and not manual steps: the Oracle Security List is a
# cloud layer nobody edits from inside the VM, but it is NOT enough on its
# own -- the instance's own iptables also has to allow each port, or a port
# open in the cloud still times out. Those local rules (and the NIC MTU,
# which Oracle images can ship wrong at 9000/jumbo) were applied by hand
# during tela's TURN setup; left that way they'd silently drift, and a
# rebuilt host would come back broken with no record of why. Encoding them
# here makes the host reproducible from the repo.
#
# How it reaches the host: the Docker provider talks to the remote dockerd
# over SSH, so the only command channel this config has is "run a
# container". A one-shot `--privileged --pid=host --net=host` container
# shares the host's network + mount namespaces, so its `iptables` IS the
# host's, and `nsenter -t 1` writes the netplan drop-in on the real root
# filesystem. Idempotent by construction: each rule/file is only written
# when absent, so re-running is a no-op.
resource "null_resource" "baseline" {
  count = var.enabled ? 1 : 0

  # Re-run only when the desired state actually changes.
  triggers = {
    interface = var.interface
    mtu       = var.interface != "" ? tostring(var.mtu) : ""
    rules     = join("\n", var.firewall_rules)
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST = var.docker_host
      # base64 so the multi-line rule list and the script itself cross the
      # shell/docker/ssh layers without any quoting to get wrong (nested
      # heredocs here broke on newlines).
      IFACE_B64 = base64encode(var.interface)
      MTU_B64   = base64encode(var.interface != "" ? tostring(var.mtu) : "")
      RULES_B64 = base64encode(join("\n", var.firewall_rules))
      SCRIPT    = base64encode(file("${path.module}/apply.sh"))
    }
    # The script runs inside the container (on the host), decoded from the
    # passed-through base64 -- no quoting-sensitive interpolation.
    command = <<-EOT
      docker run --rm --privileged --pid=host --net=host \
        -e IFACE_B64 -e MTU_B64 -e RULES_B64 -e SCRIPT \
        alpine:3.20 sh -c 'printf "%s" "$SCRIPT" | base64 -d > /tmp/apply.sh; sh /tmp/apply.sh'
    EOT
  }
}
