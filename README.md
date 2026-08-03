# gio-random-projects

Infra-as-code for gio-server: tunnels, reverse proxy config, and anything else
that keeps the server running. Each subsystem lives in its own folder under
`infra/` with its own `docker-compose.yml`, and deploys independently in
Openship (each project points at its own subfolder).

To bring everything up at once locally: `docker compose -f docker-compose.all.yml up -d`
