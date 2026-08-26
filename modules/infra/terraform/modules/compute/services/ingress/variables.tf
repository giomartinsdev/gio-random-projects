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

variable "static_sites" {
  description = "hostname/bucket pairs served straight out of MinIO -- no container behind these at all. See root locals.tf's static_sites."
  type = list(object({
    hostname = string
    bucket   = string
  }))
  default = []
}

variable "minio_port" {
  description = "MinIO's S3 API port, published to loopback by modules/storage/minio -- the only way this host-networked container reaches it (the docker-network name 'minio' isn't visible from here)."
  type        = number
  default     = 9000
}
