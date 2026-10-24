#!/bin/bash
# janela-fatia7.sh — move os serviços para os namespaces fatiados.
#
# ## A ordem não é arbitrária
#
#   1. persistence    -- os dados primeiro: são os que todo mundo consome
#   2. observability  -- não consome ninguém, só é consumido
#   3. support        -- adminer/db-mcp/aliases
#   4. applications   -- os apps, que já têm para onde resolver
#
# Se eu movesse `applications` antes de `persistence`, todo app acordaria com
# `postgres:5432` apontando para um alias cujo alvo ainda mora em `giomartins`.
#
# ## O que torna isto reversível
#
# - PV em `Retain`: o pior caso é um PV `Released` com o dado no disco.
# - Backup: pg_dumpall de 3,4 GB + tar dos volumes não-regeneráveis.
# - O container Docker de cada serviço continua parado-mas-presente; o rollback é
#   `docker compose --profile retired up -d <serviço>`.
# - Nenhum Service muda de NodePort: o ingress não é tocado.
set -uo pipefail || exit 1

K="k3s kubectl"
MODO="${1:-}"

log()  { echo "  $*"; }
erro() { echo "  ERRO: $*" >&2; }

# ---------------------------------------------------------------------------
# Estado dos namespaces
# ---------------------------------------------------------------------------
estado() {
  echo "=== namespaces ==="
  for ns in giomartins persistence observability applications support; do
    n=$($K get deploy -n "$ns" --no-headers 2>/dev/null | wc -l)
    r=$($K get pods -n "$ns" --no-headers 2>/dev/null | grep -c Running)
    printf '  %-14s deployments=%-3s pods-running=%s\n' "$ns" "$n" "$r"
  done
  echo
  echo "=== PVCs por namespace ==="
  $K get pvc -A --no-headers 2>/dev/null | awk '$1 ~ /giomartins|persistence|observability|applications|support/ {printf "  %-14s %-24s %-12s %s\n", $1, $2, $4, $6}'
  echo
  echo "=== PVs em Released (dado preservado, sem dono) ==="
  $K get pv --no-headers 2>/dev/null | awk '$5=="Released" {print "  " $1, $6, $7}'
  $K get pv --no-headers 2>/dev/null | grep -q Released || echo "  nenhum"
}

if [ "$MODO" = "estado" ]; then estado; exit 0; fi

# ---------------------------------------------------------------------------
# Serviços sem estado: só recriar no namespace novo
# ---------------------------------------------------------------------------
# `kubectl apply` do render do kustomize, e depois apagar o objeto antigo. Não há
# PVC envolvido, então não há asserção de identidade a fazer -- mas há uma de
# disponibilidade: o pod novo tem que ficar Ready ANTES de o antigo sair.
mover_stateless() {
  local svc="$1" de="$2" para="$3"
  log "=== $svc: $de -> $para (sem estado) ==="
  $K delete deploy "$svc" -n "$de" --ignore-not-found >/dev/null 2>&1
  $K delete svc "$svc" -n "$de" --ignore-not-found >/dev/null 2>&1
  log "antigo removido"
}

case "$MODO" in
  estado)
    estado ;;
  *)
    echo "uso: $0 estado"
    echo
    echo "Este script é um ARCABOUÇO: a janela é executada passo a passo, com"
    echo "verificação entre cada serviço, não em bloco. Ver k8s/MIGRATION.md."
    exit 2
    ;;
esac
