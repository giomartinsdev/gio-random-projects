variable "registry_host" {
  description = "Registry host the cch-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's HTTP side binds on."
  type        = number
  default     = 8008
}

variable "frontend_origins" {
  description = "cch-frontend's own origin(s) -- the only ones the REST API sends CORS headers for and the WebSocket accepts a connection from. Same convention as tela_api's frontend_origins."
  type        = list(string)
  default     = []
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other app modules: false, since go-ci-cd.yml's own terraform apply -replace=... is the redeploy mechanism."
  type        = bool
  default     = false
}