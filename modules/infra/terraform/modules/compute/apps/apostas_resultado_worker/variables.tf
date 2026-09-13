variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- reaches domain-api by container name."
  type        = string
}

variable "registry_host" {
  description = "Registry host the apostas-resultado-worker image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "domain_api_url" {
  description = "Internal URL apostas-resultado-worker's domain-api client talks to -- container-to-container on network_name (bridge, not host networking)."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "apostas-resultado-worker's own X-API-Key for the domain-api command pipeline."
  type        = string
  sensitive   = true
}

variable "poll_interval_seconds" {
  description = "How often the worker sweeps every pending aposta for a resolvable result, in seconds -- default once a day."
  type        = number
  default     = 24 * 60 * 60
}

variable "ai_base_url" {
  description = "The OpenAI-compatible endpoint the worker's text-reasoning client posts to -- defaults to 9router's internal docker-network address, same as apostas-api's own ai_base_url."
  type        = string
  default     = "http://9router:20128/v1"
}

variable "ai_model" {
  description = "Model name the worker asks 9router for -- reuses the same confirmed-working model apostas-api's vision client uses (a vision-capable model handles text-only prompts fine too), so there's one fewer model to keep track of on the 9router dashboard."
  type        = string
  default     = "ag/gemini-3.7-flash-low"
}

variable "ai_api_key" {
  description = "9router's own API key -- same key material as apostas-api's ai_api_key (see that module's variable for why an empty key isn't safe to assume). See modules/compute/services/ai_proxy's own dashboard for the current key."
  type        = string
  sensitive   = true
  default     = ""
}

variable "sportsdata_base_url" {
  description = "BSD Sports Data API root (sports.bzzoiro.com) the worker looks up real match results against -- the football tier is free but still requires a registered token, see sportsdata_api_key."
  type        = string
  default     = "https://sports.bzzoiro.com/api/v2"
}

variable "sportsdata_api_key" {
  description = "BSD's own API token (sports.bzzoiro.com/dashboard/) -- not Terraform-generated, that dashboard mints it, same pattern as apostas_ai_api_key."
  type        = string
  sensitive   = true
  default     = ""
}

variable "watchtower_enabled" {
  description = "Same reasoning as every other app module's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
