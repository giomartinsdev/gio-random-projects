variable "flaresolverr_image" {
  description = "FlareSolverr image tag. Bump first when challenges come back (pinned: solver logic ages with Cloudflare)."
  type        = string
  default     = "ghcr.io/flaresolverr/flaresolverr:v3.5.0"
}

variable "network_name" {
  description = "Docker network (from network/docker_apps)."
  type        = string
}