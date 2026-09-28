#!/usr/bin/env sh
# Emits the VPS's private (VCN) address as {"private_ip":"..."} for the
# `data "external"` source in main.tf. The address is only reachable from
# the instance itself (Oracle's metadata service, IMDS), so this runs the
# query over the same SSH channel the docker provider already uses -- no
# new secret, no extra network path.
#
# Reads the docker_host connection string from stdin (Terraform passes the
# `query` map as JSON there), e.g. {"docker_host":"ssh://ubuntu@1.2.3.4"}.
# Fails loudly (non-zero) if the address can't be read: a coturn with no
# private address to relay into is worse than no coturn, so the caller
# must decide with a real value, not a silent empty string.
set -eu

QUERY=$(cat)
HOST=$(printf '%s' "$QUERY" | sed -n 's/.*"docker_host"[[:space:]]*:[[:space:]]*"ssh:\/\/\([^"]*\)".*/\1/p')
if [ -z "$HOST" ]; then
  echo "discover_private_ip: docker_host not supplied or not an ssh:// URL" >&2
  exit 1
fi

IP=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$HOST" \
  'curl -s --max-time 5 -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/vnics/' \
  | grep -oE '"privateIp"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')

if [ -z "$IP" ]; then
  echo "discover_private_ip: could not read the private address from $HOST" >&2
  exit 1
fi

printf '{"private_ip":"%s"}\n' "$IP"
