variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- reaches domain-api by container name."
  type        = string
}

variable "registry_host" {
  description = "Registry host the leads-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8015 is published on -- 8015 is leads-api's slot in locals.tf's services (ingress routes leads-api.giomartins.dev here)."
  type        = number
  default     = 8015
}

variable "frontend_origins" {
  description = "Origins allowed to call leads-api cross-origin (CORS) -- financas-frontend's origin and local dev. No credentials mode: this route has no session cookie to carry."
  type        = list(string)
  default     = ["https://financas.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL leads-api's domain-api client talks to -- container-to-container on network_name (bridge, not host networking)."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "leads-api's own X-API-Key for the domain-api command pipeline."
  type        = string
  sensitive   = true
}

variable "otlp_endpoint" {
  description = "OTLP endpoint for traces/metrics -- module.compute_services_observability.otlp_endpoint."
  type        = string
  default     = ""
}

variable "watchtower_enabled" {
  description = "Same reasoning as every other app module's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
