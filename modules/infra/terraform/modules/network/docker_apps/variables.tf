variable "network_name" {
  description = "Name of the docker network app containers join to reach postgres/redis by hostname."
  type        = string
  default     = "apps"
}
