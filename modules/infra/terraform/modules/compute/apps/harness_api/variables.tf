variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- no runtime dependency on it (state is local SQLite), it's the bet_api shape every published-port app here joins."
  type        = string
}

variable "registry_host" {
  description = "Registry host the harness-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8010 is published on -- 8010 is harness-api's slot in locals.tf's services (ingress routes harness-api.giomartins.dev here)."
  type        = number
  default     = 8010
}

variable "access_team_domain" {
  description = "The Cloudflare Access team domain this zone belongs to -- the app composes HARNESS_ACCESS_ISSUER from it and fetches the team's JWKS from <issuer>/cdn-cgi/access/certs to verify the edge-injected Cf-Access-Jwt-Assertion."
  type        = string
  default     = "workwithgiomartinsdev.cloudflareaccess.com"
}

variable "access_aud" {
  description = "The `aud` tag of the harness-api Access application (module.cloud_cloudflare.access_app_auds output; the single /api app, login hop included) -- every Access JWT minted for it carries this aud, and harness-api pins it as the acceptable token audience."
  type        = list(string)
}

variable "allowed_emails" {
  description = "Defense-in-depth email allowlist checked after the Access JWT verifies (the edge's Google-SSO policy already enforces the same list)."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com", "workwithgiomartinsdev@gmail.com"]
}

variable "frontend_origins" {
  description = "Origins allowed to call harness-api cross-origin (CORS) and accepted by /api/sso's return-parameter allowlist -- the SPA's origin and the local dev server."
  type        = list(string)
  default     = ["https://harness-frontend.giomartins.dev", "http://localhost:5173"]
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/apps/post_api's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}