# Image tags are pinned literals (same reasoning as every other module
# here: a floating tag would let any apply silently upgrade the stack).
# All five publish multi-arch manifests (amd64 + arm64) — the VPS is
# arm64, so a single-arch image would fail to pull, not just to run.

variable "network_name" {
  description = "Shared docker network every container joins — apps reach alloy by container name, prometheus scrapes grafana/loki/tempo/alloy the same way."
  type        = string
}

variable "frontend_origins" {
  description = "The two SPA origins whose browsers may POST telemetry to otel.giomartins.dev — alloy's OTLP receiver CORS allowlist, and that's the whole access control on the public endpoint. Same list shape as the app modules' own frontend_origins."
  type        = list(string)
}

variable "grafana_admin_password" {
  description = "Grafana's admin login password — Terraform-generated (secrets.tf), seeded into Vaultwarden."
  type        = string
  sensitive   = true
}

variable "grafana_image_tag" {
  description = "grafana/grafana-oss tag."
  type        = string
  default     = "12.4.3"
}

variable "loki_image_tag" {
  description = "grafana/loki tag."
  type        = string
  default     = "3.7.7"
}

variable "prometheus_image_tag" {
  description = "prom/prometheus tag."
  type        = string
  default     = "v3.14.0"
}

variable "tempo_image_tag" {
  description = "grafana/tempo tag."
  type        = string
  default     = "2.10.8"
}

variable "alloy_image_tag" {
  description = "grafana/alloy tag."
  type        = string
  default     = "v1.19.2"
}