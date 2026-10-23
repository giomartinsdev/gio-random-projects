#!/bin/bash
# sync-app-secrets.sh — cria/atualiza os Secrets do k8s a partir do ambiente
# REAL dos containers Docker que ainda estão rodando.
#
# Por que derivar em vez de digitar: o container em produção é a fonte da
# verdade do que a aplicação precisa. Copiar o env de lá elimina a classe de
# erro "esqueci uma variável na migração" — que só aparece quando o serviço cai
# em runtime, com o ArgoCD mostrando tudo verde.
#
# Por que não no git: o repositório é PÚBLICO. O manifesto referencia os
# Secrets por nome (`secretKeyRef`/`envFrom`); os valores só existem no cluster.
#
# Idempotente: rodar de novo reaplica os valores atuais. Serve tanto para o
# bootstrap quanto para sincronizar uma rotação de credencial.
#
# Instalação:
#   sudo install -m 755 sync-app-secrets.sh /usr/local/sbin/sync-app-secrets.sh
#
# Uso:
#   sudo sync-app-secrets.sh          # aplica todos
#   sudo sync-app-secrets.sh domain-api   # aplica um
set -uo pipefail

NS="giomartins"
K3S="k3s"

# Variáveis injetadas pela imagem base (Dockerfile/linguagem), não pela
# aplicação. Copiá-las para o Secret é ruído e pode até atrapalhar — o PATH de
# um container Go não deve ser imposto ao pod por um Secret.
IGNORAR='^(PATH|HOSTNAME|HOME|LANG|LANGUAGE|LC_ALL|GPG_KEY|PYTHON_VERSION|PYTHON_SHA256|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE|NODE_VERSION|YARN_VERSION|SSL_CERT_FILE|TERM)$'

# <nome-do-secret>=<container-docker>[:<chave-que-veio-de-outro-lugar>]
#
# Os segredos são derivados do container homônimo. Quando o nome do container
# difere do serviço no k8s, o mapeamento é explícito.
MAPA=(
  "domain-api:domain-api"
  "domain-worker:domain-worker"
  "finance-api:finance-api"
  "finance-customersupport-worker:finance-customersupport-worker"
  "finance-openfinance-worker:finance-openfinance-worker"
  "vaultwarden-api:vaultwarden-api"
)

alvo="${1:-}"

for entrada in "${MAPA[@]}"; do
  IFS=: read -r secret container <<< "$entrada"

  if [ -n "$alvo" ] && [ "$alvo" != "$secret" ]; then
    continue
  fi

  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "[skip] container $container não existe"
    continue
  fi

  # Monta os --from-literal em um array, sem passar por shell.
  args=()
  qtd=0
  while IFS= read -r linha; do
    [ -z "$linha" ] && continue
    chave="${linha%%=*}"
    valor="${linha#*=}"
    # Ignora as vars da imagem base e as que o Kubernetes injeta sozinho.
    if [[ "$chave" =~ $IGNORAR ]]; then continue; fi
    if [[ "$chave" == *"*"* ]]; then continue; fi
    args+=(--from-literal="${chave}=${valor}")
    qtd=$((qtd+1))
  done < <(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')

  if [ "$qtd" -eq 0 ]; then
    echo "[skip] $secret: nenhuma variável aproveitável"
    continue
  fi

  $K3S kubectl create secret generic "$secret" -n "$NS" \
      "${args[@]}" --dry-run=client -o yaml \
    | $K3S kubectl apply -f - >/dev/null

  echo "[ok] secret/$secret <- $container ($qtd chaves)"
done
