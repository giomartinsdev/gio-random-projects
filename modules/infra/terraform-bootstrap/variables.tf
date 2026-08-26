variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "cloudflare_user_id" {
  description = "Cloudflare user ID (GET https://api.cloudflare.com/client/v4/user, .result.id) — scopes cloudflare_api_token.bootstrap's own \"API Tokens Read\" policy, see token.tf."
  type        = string
}
