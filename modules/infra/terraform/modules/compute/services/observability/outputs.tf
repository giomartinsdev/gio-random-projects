# The one value other modules need: where apps point their OpenTelemetry
# SDKs. Everything else about this stack is reachable only from inside
# the docker network (or through ingress, for the two browser-facing
# hostnames).

output "otlp_endpoint" {
  description = "Base URL for apps' OTEL_EXPORTER_OTLP_ENDPOINT — OTLP/HTTP on alloy, resolvable by container name on the shared network."
  value       = "http://alloy:4318"
}

output "otlp_endpoint_loopback" {
  # host-networked apps (tela-api) aren't on the docker network, so
  # "alloy" doesn't resolve for them — but alloy's 4318 is published on
  # 127.0.0.1 exactly for ingress, and a host-network container shares
  # the host's loopback.
  description = "Same OTLP/HTTP endpoint for host-networked containers (network_mode = \"host\"), which reach it over the host's loopback."
  value       = "http://127.0.0.1:4318"
}

output "grafana_internal_url" {
  description = "Grafana's in-network URL (Prometheus scrapes :3000/metrics; humans go through grafana.giomartins.dev instead)."
  value       = "http://grafana:3000"
}