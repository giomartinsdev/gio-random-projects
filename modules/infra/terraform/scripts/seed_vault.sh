#!/usr/bin/env sh
# Upserts NAME=VALUE pairs into Vaultwarden over the internal docker
# network -- used both by Terraform (root secrets.tf's
# null_resource.vault_seed, for the app-level secrets it generates) and
# directly from tf-deploy.yml (to back up the handful of "secret zero"
# credentials Terraform itself needs to authenticate, which by
# definition it can't fetch from the vault to configure itself). Never
# touches vault.giomartins.dev or Cloudflare Access -- this runs over
# the same "vaultwarden" hostname the bridge itself uses. The one
# wrinkle: the bw CLI refuses non-HTTPS server URLs even for purely-
# internal traffic, so this still needs a tiny local self-signed-HTTPS
# proxy in front of the plain-HTTP internal listener.
#
# Required env: NETWORK_NAME, VAULTWARDEN_CLIENT_ID,
# VAULTWARDEN_CLIENT_SECRET, VAULTWARDEN_MASTER_PASSWORD, and
# ITEMS_B64 -- base64 of newline-separated "NAME<TAB>VALUE" pairs.
set -eu

SCRIPT=$(cat <<'INNER'
set -eu
apk add --no-cache openssl jq >/dev/null
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

upsert_item() {
  name="$1"
  value="$2"
  existing_id=$(bw list items --search "$name" | jq -r --arg n "$name" '[.[] | select(.name == $n)][0].id // empty')
  payload=$(bw get template item 2>/dev/null | jq --arg n "$name" --arg v "$value" \
    '.type=1 | .name=$n | .login={"username":null,"password":$v}')
  if [ -n "$existing_id" ]; then
    echo "$payload" | jq --arg id "$existing_id" '.id=$id' | bw encode | bw edit item "$existing_id" >/dev/null
    echo "updated $name"
  else
    echo "$payload" | bw encode | bw create item >/dev/null
    echo "created $name"
  fi
}

echo "$ITEMS_B64" | base64 -d | while IFS="$(printf '\t')" read -r name value; do
  [ -n "$name" ] || continue
  upsert_item "$name" "$value"
done
INNER
)

# -d (detach) + wait + logs, not a plain foreground `docker run --rm`:
# an attached run hijacks the connection into a raw stream to relay
# stdio, and that hijack doesn't survive the CI Access proxy/tunnel hop
# (fails with "unable to upgrade to tcp, received 200"). `wait` and
# non-follow `logs` are plain request/response calls, same as the
# container create/start calls that already work through this proxy.
CID=$(docker run -d --network "$NETWORK_NAME" \
  -e VAULTWARDEN_CLIENT_ID -e VAULTWARDEN_CLIENT_SECRET -e VAULTWARDEN_MASTER_PASSWORD \
  -e ITEMS_B64 \
  node:20-alpine sh -c "$SCRIPT")

EXIT_CODE=$(docker wait "$CID")
docker logs "$CID"
docker rm "$CID" >/dev/null

if [ "$EXIT_CODE" != "0" ]; then
  echo "vault seed container exited $EXIT_CODE" >&2
  exit 1
fi
