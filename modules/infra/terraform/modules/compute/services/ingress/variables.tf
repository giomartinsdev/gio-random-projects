variable "services" {
  description = "hostname/port pairs to route by Host header -- straight from root locals.tf's services list, minus registry.giomartins.dev (see this module's README for why that one stays out)."
  type = list(object({
    hostname = string
    port     = number
  }))
}

variable "nginx_version" {
  description = "nginx:<version> image tag."
  type        = string
  default     = "1.27-alpine"
}
