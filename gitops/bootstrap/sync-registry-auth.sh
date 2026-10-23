#!/bin/bash
# sync-registry-auth.sh — leva o htpasswd do registry Docker para um Secret do k8s.
#
# ## Por que um script e não um `kubectl create secret`
#
# O htpasswd é a ÚNICA coisa que o registry do k8s não herda do volume de dados:
# ele mora num volume separado (`registry_registry-auth`). Um Secret com o hash
# errado faria o registry novo rejeitar o `docker login` do CI e de todo pull —
# com o pod `Running` e `Ready`, porque a autenticação só é exercitada quando
# alguém puxa.
#
# ## Por que não está no git
#
# O repositório é público. Um hash bcrypt vaza a senha por força bruta offline,
# e a senha do registry é a mesma que o Vaultwarden guarda (secrets.tf,
# `vault_seed` "registry"). O caminho aqui é o mesmo dos outros Secrets: o
# valor existe só no cluster, e este script é o que o instala.
#
# ## Idempotente, e falha alto
#
# `--dry-run=client -o yaml | kubectl apply` reaplica sem mudar o UID do Secret.
# Se o volume Docker não existir (host novo, registry removido), o script aborta
# em vez de criar um Secret vazio — um registry com htpasswd vazio aceita
# QUALQUER login, então "vazio" não é um estado inofensivo.
#
# Uso:
#   sudo ./sync-registry-auth.sh
#
# Verificação, depois:
#   k3s kubectl get secret registry-auth -n support -o jsonpath='{.data.htpasswd}' \
#     | base64 -d | cut -d: -f1      # deve imprimir o(s) usuário(s)
set -uo pipefail

K="k3s kubectl"
NS="support"
ORIGEM="/var/lib/docker/volumes/registry_registry-auth/_data/htpasswd"

[ -r "$ORIGEM" ] || { echo "ERRO: $ORIGEM não existe ou não é legível (rode com sudo)"; exit 1; }

# A cópia vai para um arquivo temporário com mode 600, nunca para argv: um
# `kubectl create secret --from-literal` deixaria o hash visível em `ps` para
# qualquer usuário do host.
TMP=$(mktemp) || exit 1
trap 'rm -f "$TMP"' EXIT
cat "$ORIGEM" > "$TMP"

linhas=$(wc -l < "$TMP" | tr -d ' ')
[ "$linhas" -ge 1 ] || { echo "ERRO: htpasswd vazio — abortando"; exit 1; }

echo "=== registry-auth -> namespace $NS ($linhas entrada(s)) ==="
# `--from-file` com o nome da chave explícito: o Secret precisa ter a chave
# `htpasswd`, que é o nome do arquivo montado em /auth/htpasswd no pod.
$K create secret generic registry-auth \
  --namespace "$NS" \
  --from-file=htpasswd="$TMP" \
  --dry-run=client -o yaml \
  | $K apply -f - || { echo "ERRO: falhou ao aplicar o Secret"; exit 1; }

echo
echo "=== conferindo o que ficou no cluster ==="
no_cluster=$($K get secret registry-auth -n "$NS" -o jsonpath='{.data.htpasswd}' | base64 -d | sha256sum | awk '{print $1}')
no_host=$(sha256sum "$TMP" | awk '{print $1}')
if [ "$no_cluster" = "$no_host" ]; then
  echo "  sha256 idêntico ao do volume Docker: $no_host"
  echo "  usuários: $($K get secret registry-auth -n "$NS" -o jsonpath='{.data.htpasswd}' | base64 -d | cut -d: -f1 | tr '\n' ' ')"
else
  echo "  ERRO: sha256 diverge (cluster=$no_cluster host=$no_host)"
  exit 1
fi
