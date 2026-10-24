#!/usr/bin/env sh
# Reads items from Vaultwarden by name and prints "ENV_NAME=value"
# lines to stdout, one per requested mapping, used by CI to fetch a
# secret Terraform already seeded into the vault instead of keeping a
# separate copy in GitHub Secrets. Same self-signed-HTTPS-proxy
# wrinkle seed_vault.sh has: the bw CLI refuses non-HTTPS server URLs
# even for purely internal traffic.
#
# Required env: VAULTWARDEN_CLIENT_ID, VAULTWARDEN_CLIENT_SECRET,
# VAULTWARDEN_MASTER_PASSWORD, and ITEM_MAP -- space-separated
# "ENV_NAME=VaultItemName" pairs. The left side is whatever env var
# the caller wants the value under; the right side is the vault item's
# own name (e.g. REGISTRY_PASSWORD, matching exactly what
# seed_vault.sh created it as).
#
# ## VAULTWARDEN_UPSTREAM: onde o proxy procura o servidor
#
# `host:port`, default `vaultwarden:80` (o nome na rede Docker `apps`
# -- o que este script fazia quando o Vaultwarden era container).
#
# Desde 2026-10-23 o Vaultwarden é POD (`k8s/apps/persistence/
# vaultwarden/`), e o container homônimo só existe como rollback
# parado -- nome de container parado sai do DNS do Docker, então
# `vaultwarden` respondia `EAI_AGAIN` e TODO pipeline de imagem
# quebrou no passo de buscar a credencial do registry.
#
# O CI passa `host.docker.internal:30822`: o NodePort do Service
# `vaultwarden` no k3s (convenção `8xxx -> 308xx`, porta fixa por
# decisão -- ver k8s/README.md). Precisa do `--add-host` abaixo:
# `host.docker.internal` não vem de graça num container Linux.
#
# Por que NodePort e não o ClusterIP: o IP do Service é alocado pelo
# cluster e muda se o Service for recriado; o NodePort é constante e
# já é a forma como o ingress do host alcança o resto dos pods.
#
# NETWORK_NAME continua aceito e continua anexando o container à
# rede `apps`, mas deixou de ser necessário para achar o servidor --
# é só a rede de saída.
set -eu

SCRIPT=$(cat <<'INNER'
set -eu

cat > /tmp/proxy.js <<'JS'
const http = require('http');
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/tmp/proxy.key'),
  cert: fs.readFileSync('/tmp/proxy.crt'),
};

// "host:port" -- ver o comentario de VAULTWARDEN_UPSTREAM no topo
// deste script. O default preserva o comportamento antigo (nome na
// rede Docker `apps`).
const upstreamSpec = process.env.VAULTWARDEN_UPSTREAM || 'vaultwarden:80';
const sep = upstreamSpec.lastIndexOf(':');
const upstreamHost = sep > 0 ? upstreamSpec.slice(0, sep) : upstreamSpec;
const upstreamPort = sep > 0 ? Number(upstreamSpec.slice(sep + 1)) : 80;

https.createServer(options, (req, res) => {
  const upstream = http.request(
    { host: upstreamHost, port: upstreamPort, path: req.url, method: req.method, headers: req.headers },
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

bw config server https://127.0.0.1:8087 >/dev/null
bw login --apikey >/dev/null
SESSION=$(bw unlock --passwordenv BW_PASSWORD --raw)
export BW_SESSION="$SESSION"

for pair in $ITEM_MAP; do
  env_name="${pair%%=*}"
  item_name="${pair#*=}"
  # A trailing "?" on the item name marks it optional: a not-yet-created
  # item exports an EMPTY value instead of failing the whole fetch.
  # Exists for the chicken-and-egg of items secrets.tf seeds on apply
  # (e.g. DISCORD_ANNOUNCE_WEBHOOK_URL): the fetch runs BEFORE the
  # apply that would seed the item, so the very first runs after adding
  # one would always fail -- optional items bootstrap as "" and the
  # feature they gate stays off (everything in this repo treats an
  # empty value as "disabled", by design) until the real value is set
  # in the vault. Items without the "?" still hard-fail: a missing
  # REGISTRY_PASSWORD etc. is always a real breakage worth stopping
  # the deploy for.
  optional=""
  if [ "${item_name%\?}" != "$item_name" ]; then
    optional=1
    item_name="${item_name%\?}"
  fi
  # get item, not get password: distinguishes "item doesn't exist"
  # (hard failure below) from "item exists with a genuinely empty
  # password" (e.g. discord_client_id when the integration is
  # disabled -- a valid, expected state, not a fetch failure).
  item_json=$(bw get item "$item_name" 2>/dev/null || true)
  if [ -z "$item_json" ]; then
    if [ -n "$optional" ]; then
      echo "fetch_vault_secret: no such vault item: $item_name (optional -- exporting empty)" >&2
      echo "${env_name}="
      continue
    fi
    echo "fetch_vault_secret: no such vault item: $item_name" >&2
    exit 1
  fi
  value=$(echo "$item_json" | jq -r '.login.password // ""')
  echo "${env_name}=${value}"
done
INNER
)

# Attached (not -d like seed_vault.sh's own container): DOCKER_HOST
# here is a plain ssh:// connection, which streams stdout back fine --
# seed_vault.sh's detach+poll dance exists for a now-gone Access-proxy
# hop this doesn't have to cross.
#
# NETWORK_NAME e opcional: o servidor agora e achado por
# VAULTWARDEN_UPSTREAM (NodePort do k3s), nao mais por DNS de rede
# Docker. Quando definido, ainda anexa o container a ela -- o default
# de quem chama e `apps`.
#
# `--add-host` e inofensivo quando o upstream e um nome normal e e o
# que faz `host.docker.internal` existir quando o upstream e o NodePort
# do pod (ver comentario do topo).
NET_ARGS=""
[ -n "${NETWORK_NAME:-}" ] && NET_ARGS="--network $NETWORK_NAME"

# shellcheck disable=SC2086
docker run --rm $NET_ARGS --add-host host.docker.internal:host-gateway \
  -e VAULTWARDEN_CLIENT_ID -e VAULTWARDEN_CLIENT_SECRET -e VAULTWARDEN_MASTER_PASSWORD \
  -e ITEM_MAP -e VAULTWARDEN_UPSTREAM \
  registry.giomartins.dev:5000/vault-cli:latest sh -c "$SCRIPT"
