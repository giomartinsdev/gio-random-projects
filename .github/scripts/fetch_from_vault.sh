#!/usr/bin/env sh
# Fetches items from Vaultwarden over the internal docker network and
# writes them to $GITHUB_ENV (masked in logs via ::add-mask::), so
# later steps in the same job can use them like any other env var --
# without a GH Actions secret ever holding the value, and without ever
# touching vault.giomartins.dev or Cloudflare Access. Read-side sibling
# of modules/infra/terraform/scripts/seed_vault.sh -- see that script
# for why the tiny local self-signed-HTTPS proxy is unavoidable even
# for purely-internal traffic (the bw CLI refuses non-HTTPS server
# URLs outright).
#
# Requires the docker.giomartins.dev Access proxy sidecar already
# running at $DOCKER_HOST (see any workflow's "Start Cloudflare Access
# header-injecting proxy for dockerd" step) -- that's what lets this
# reach gio-server's dockerd at all, to launch a container on the same
# network Vaultwarden itself is on.
#
# Required env: DOCKER_HOST, NETWORK_NAME, VAULTWARDEN_CLIENT_ID,
# VAULTWARDEN_CLIENT_SECRET, VAULTWARDEN_MASTER_PASSWORD, ITEM_NAMES
# (space-separated Vaultwarden item names -- each becomes a same-named
# env var holding that item's password field).
set -eu

SCRIPT=$(cat <<'INNER'
set -eu
apk add --no-cache openssl >/dev/null
npm install -g @bitwarden/cli >/dev/null 2>&1

cat > /tmp/proxy.js <<'JS'
const http = require('http');
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/tmp/proxy.key'),
  cert: fs.readFileSync('/tmp/proxy.crt'),
};

https.createServer(options, (req, res) => {
  const upstream = http.request(
    { host: 'vaultwarden', port: 80, path: req.url, method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  req.pipe(upstream);
}).listen(8087, '127.0.0.1');
JS

openssl req -x509 -newkey rsa:2048 -keyout /tmp/proxy.key -out /tmp/proxy.crt \
  -days 1 -nodes -subj "/CN=localhost" 2>/dev/null
node /tmp/proxy.js &
sleep 1

export NODE_TLS_REJECT_UNAUTHORIZED=0
export BW_CLIENTID="$VAULTWARDEN_CLIENT_ID"
export BW_CLIENTSECRET="$VAULTWARDEN_CLIENT_SECRET"
export BW_PASSWORD="$VAULTWARDEN_MASTER_PASSWORD"

bw config server https://127.0.0.1:8087
bw login --apikey
SESSION=$(bw unlock --passwordenv BW_PASSWORD --raw)
export BW_SESSION="$SESSION"

mkdir -p /output
: > /output/secrets.env
for name in $ITEM_NAMES; do
  value=$(bw get password "$name")
  printf '%s\t' "$name" >> /output/secrets.env
  printf '%s' "$value" | base64 | tr -d '\n' >> /output/secrets.env
  printf '\n' >> /output/secrets.env
done
INNER
)

# -d (detach), not a plain foreground `docker run --rm`: an attached
# run hijacks the connection into a raw stream to relay stdio, and
# that hijack doesn't survive the CI Access proxy/tunnel hop (fails
# with "unable to upgrade to tcp, received 200").
CID=$(docker run -d --network "$NETWORK_NAME" \
  -e VAULTWARDEN_CLIENT_ID -e VAULTWARDEN_CLIENT_SECRET -e VAULTWARDEN_MASTER_PASSWORD \
  -e ITEM_NAMES \
  node:20-alpine sh -c "$SCRIPT")

# Poll instead of `docker wait`: that blocks on a single long-held
# connection until the container exits, and Cloudflare Tunnel's own
# edge timeout (~100s, independent of anything nginx is configured
# with) kills it with a 524 before the real response ever arrives.
STATUS="running"
for i in $(seq 1 60); do
  STATUS=$(docker inspect -f '{{.State.Status}}' "$CID")
  [ "$STATUS" = "running" ] || break
  sleep 5
done

if [ "$STATUS" = "running" ]; then
  echo "vault fetch container still running after 5 minutes" >&2
  docker logs "$CID" || true
  docker rm -f "$CID" >/dev/null || true
  exit 1
fi

EXIT_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$CID")
if [ "$EXIT_CODE" != "0" ]; then
  docker logs "$CID" || true
  docker rm "$CID" >/dev/null
  echo "vault fetch container exited $EXIT_CODE" >&2
  exit 1
fi

# docker cp, not docker logs: the fetched values themselves never go
# through stdout/the container log, only this file transfer -- nothing
# sensitive ever appears in the Actions log for this step.
docker cp "$CID:/output/secrets.env" ./vault_secrets.env
docker rm "$CID" >/dev/null

while IFS="$(printf '\t')" read -r name value_b64; do
  [ -n "$name" ] || continue
  value=$(echo "$value_b64" | base64 -d)
  echo "::add-mask::$value"
  echo "$name=$value" >> "$GITHUB_ENV"
done < ./vault_secrets.env
rm -f ./vault_secrets.env
