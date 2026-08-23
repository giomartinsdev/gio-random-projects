variable "registry_user" {
  description = "Basic-auth username for docker push/pull against the registry."
  type        = string
  default     = "admin"
}

variable "registry_password" {
  description = "Basic-auth password for the registry. Generate: openssl rand -base64 24. Also needs a matching `docker login` on the host so watchtower's mounted /root/.docker/config.json can pull — see README."
  type        = string
  sensitive   = true
}

variable "registry_version" {
  description = "registry:<version> image tag."
  type        = string
  default     = "2"
}

variable "htpasswd_init_version" {
  description = "httpd:<version> image tag — only used to bcrypt the htpasswd file (registry:2 has no htpasswd tool of its own)."
  type        = string
  default     = "2.4-alpine"
}

variable "watchtower_poll_interval" {
  description = "Seconds between watchtower's checks for new :latest images."
  type        = number
  default     = 60
}

variable "watchtower_docker_api_version" {
  description = "Forced Docker API version for watchtower's client — containrrr/watchtower negotiates a hardcoded old version (1.25) that this host's Docker Engine rejects outright."
  type        = string
  default     = "1.44"
}

variable "registry_client_cert_pem" {
  description = "mTLS client certificate for registry.giomartins.dev (module.cloudflare's registry_mtls.tf) — installed onto gio-server's own dockerd cert store so watchtower's pulls (and any docker_container resource here pulling from the registry) keep working once mTLS is enforced. See README.md."
  type        = string
}

variable "registry_client_key_pem" {
  description = "Matching private key for registry_client_cert_pem."
  type        = string
  sensitive   = true
}
