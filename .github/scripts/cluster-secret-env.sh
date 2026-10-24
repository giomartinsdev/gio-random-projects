#!/usr/bin/env bash
# cluster-secret-env.sh — imprime "CHAVE=valor" lendo o Secret do PRÓPRIO
# cluster, via SSH + kubectl na VPS.
#
# ## Por que isto substituiu o Vaultwarden
#
# Até 2026-10-24 o CI pegava `REGISTRY_USERNAME`/`REGISTRY_PASSWORD` do
# Vaultwarden com `fetch_vault_secret.sh`, que fazia `docker run` de um
# `vault-cli` **no daemon da VPS**. Duas consequências:
#
#   1. o build dependia do Docker da VPS existir (bloqueava o
#      descomissionamento);
#   2. o `docker run` alcançava o NodePort `30822` por `host.docker.internal`,
#      porque `vault.giomartins.dev` está atrás do Cloudflare Access (302) e um
#      runner do GitHub não teria como passar.
#
# O cluster já é a fonte da verdade dessas credenciais: os pods consomem
# exatamente esses Secrets (`imagePullSecrets`, `secretKeyRef`). Ler dali não
# duplica segredo em lugar nenhum novo — quem lê já tem `sudo` na VPS (o
# workflow antigo rodava `sudo docker`).
#
# Nenhum valor é impresso em claro: o chamador passa cada linha por
# `::add-mask::` antes de exportar (mesmo padrão de antes).
#
# ## Uso
#
#   CLUSTER_SECRET=registry ./cluster-secret-env.sh
#   CLUSTER_SECRET=minio    ./cluster-secret-env.sh
#
# Requer `VPS_HOST` no ambiente e a chave SSH já instalada (o workflow faz
# isso antes de chamar).
set -euo pipefail

: "${VPS_HOST:?defina VPS_HOST}"
: "${CLUSTER_SECRET:?defina CLUSTER_SECRET (registry|minio)}"

case "$CLUSTER_SECRET" in
  registry)
    # dockerconfigjson: a mesma credencial que os pods usam para puxar.
    ssh -o BatchMode=yes "ubuntu@$VPS_HOST" '
      sudo kubectl -n support get secret registry-credentials \
        -o jsonpath="{.data.\.dockerconfigjson}" \
      | base64 -d \
      | python3 -c "
import json,sys,base64
d=json.load(sys.stdin)
a=list(d[\"auths\"].values())[0][\"auth\"]
u,p=base64.b64decode(a).decode().split(\":\",1)
print(\"REGISTRY_USERNAME=\"+u)
print(\"REGISTRY_PASSWORD=\"+p)
"
    '
    ;;
  minio)
    ssh -o BatchMode=yes "ubuntu@$VPS_HOST" '
      sudo kubectl -n persistence get secret minio \
        -o jsonpath="{.data.MINIO_ROOT_USER}" | base64 -d | sed "s/^/MINIO_ROOT_USER=/"
      echo
      sudo kubectl -n persistence get secret minio \
        -o jsonpath="{.data.MINIO_ROOT_PASSWORD}" | base64 -d | sed "s/^/MINIO_ROOT_PASSWORD=/"
      echo
    '
    ;;
  *)
    echo "CLUSTER_SECRET desconhecido: $CLUSTER_SECRET" >&2
    exit 2
    ;;
esac
