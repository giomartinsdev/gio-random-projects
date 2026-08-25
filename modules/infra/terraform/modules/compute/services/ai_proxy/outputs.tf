output "internal_url" {
  description = "9router's address on the internal docker network — useful if another container ever needs to reach it directly."
  value       = "http://9router:20128"
}
