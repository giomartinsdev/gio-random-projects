#!/bin/bash
# remove-parados.sh — remove os containers Docker PARADOS cujo equivalente ja
# roda em pod, um por um, conferindo o pod ANTES de cada remocao.
#
# ## O que este script NAO faz
#
#   - nao remove volume nenhum (o volume e o dado; ver o relatorio no fim);
#   - nao toca em container RODANDO (maus, minecraft, dockhand, 9router);
#   - nao remove imagem (camada separada, depois dos containers).
#
# ## Por que o pod e conferido por container e nao em bloco
#
# "tem 5 pods Running no namespace" nao prova que o pod DAQUELE servico esta
# de pe. A conferencia e por label/prefixo do nome, e a remocao so acontece se
# ele estiver Ready. Sem isso, um pod em CrashLoop e um container removido =
# servico perdido.
set -uo pipefail
K="sudo kubectl"

# <container>:<namespace>:<prefixo-do-pod>
ALVOS="
postgres:persistence:postgres
rabbitmq:persistence:rabbitmq
minio:persistence:minio
vaultwarden:persistence:vaultwarden
vaultwarden-api:applications:vaultwarden-api
evolution-api:applications:evolution-api
evolution-redis:persistence:evolution-redis
loki:observability:loki
prometheus:observability:prometheus
tempo:observability:tempo
grafana:observability:grafana
alloy:observability:alloy-logs
adminer:support:adminer
db-mcp:support:db-mcp
db-mcp-gateway:support:db-mcp-gateway
excalidraw:applications:excalidraw
tela-api:applications:tela-api
tela-coturn:applications:tela-coturn
tela-mediamtx:applications:tela-mediamtx
domain-api:applications:domain-api
domain-worker:applications:domain-worker
finance-api:applications:finance-api
finance-customersupport-worker:applications:finance-customersupport-worker
finance-openfinance-worker:applications:finance-openfinance-worker
ingress:support:ingress
registry:support:registry
"

# One-shots: ja rodaram, sao recriados pelo compose se precisar. Nao tem pod.
ONESHOTS="evolution-db-init minio-buckets-init htpasswd-init registry-docker-config-install"

FALHA=0
declare -a PARA_REMOVER=()

echo "=== 1. conferindo pod de cada servico migrado ==="
for linha in $ALVOS; do
  c=${linha%%:*}; resto=${linha#*:}
  ns=${resto%%:*}; pref=${resto##*:}

  # O container existe E esta parado?
  status=$(sudo docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo "ausente")
  if [ "$status" != "exited" ] && [ "$status" != "created" ]; then
    printf "  %-32s %-10s (nao e parado -- pulando)\n" "$c" "$status"
    continue
  fi

  ready=$($K -n "$ns" get pods --no-headers 2>/dev/null \
          | grep "^${pref}-" | grep -c "1/1.*Running")
  if [ "$ready" -ge 1 ]; then
    printf "  %-32s pod %-22s OK (%s ready)\n" "$c" "$pref" "$ready"
    PARA_REMOVER+=("$c")
  else
    printf "  %-32s pod %-22s AUSENTE <-- NAO remover\n" "$c" "$pref"
    FALHA=1
  fi
done

for c in $ONESHOTS; do
  status=$(sudo docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo "ausente")
  [ "$status" = "exited" ] && PARA_REMOVER+=("$c")
done

if [ "$FALHA" = "1" ]; then
  echo
  echo "ABORTADO: algum servico nao tem pod Ready. Remover seria perder servico."
  exit 1
fi

echo
echo "=== 2. removendo ${#PARA_REMOVER[@]} containers parados ==="
for c in "${PARA_REMOVER[@]}"; do
  if sudo docker rm "$c" >/dev/null 2>&1; then
    echo "  removido: $c"
  else
    echo "  FALHOU:   $c"
  fi
done

echo
echo "=== 3. sobrou o que (containers) ==="
sudo docker ps -a --format '  {{.Names}}\t{{.Status}}' | sort
echo "  total rodando: $(sudo docker ps -q | wc -l)"
echo "  total parado:  $(sudo docker ps -aq -f status=exited | wc -l)"
