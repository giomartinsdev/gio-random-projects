output "container_name" {
  value = docker_container.zomboid.name
}

output "connection_ports" {
  description = "Ports players/admins use in-game, as seen from outside the VPS."
  value = {
    steam_query_udp  = 16261
    game_udp         = 16262
    source_query_tcp = 27015
  }
}
