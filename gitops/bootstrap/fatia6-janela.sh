#!/bin/bash
# fatia6-janela.sh — executa a janela da fatia 6 (vaultwarden + postgres).
#
# ## O que este script faz, e o que ele deliberadamente NÃO faz
#
# Faz a parte irreversível-porém-revertível: para o container, copia o volume
# para o PVC, religa o container. Não troca Service, não muda o git, não apaga
# nada. Essa separação é o que mantém o rollback em "uma linha".
#
# ## Por que a cópia usa `cp -a` a partir do volume parado
#
# O Postgres escreve WAL continuamente; copiar com ele rodando gera um PGDATA
# inconsistente que só falha no primeiro restart. O SQLite do Vaultwarden tem o
# mesmo problema com `-wal`. Parar → copiar → religar é a única ordem segura, e
# é a mesma do `copy-volume.sh` que já migrou minio/rabbitmq/observabilidade.
#
# ## Por que o container é RELIGADO antes do pod subir
#
# Enquanto a cópia não estiver validada, o serviço antigo tem de estar de pé.
# O pod só assume depois de provar que lê o dado copiado. Se a cópia estiver
# ruim, o rollback é não fazer nada — o Docker nunca deixou de servir.
#
# ## Uso
#
#   sudo ./fatia6-janela.sh copiar <postgres|vaultwarden>
#   sudo ./fatia6-janela.sh validar <postgres|vaultwarden>
set -uo pipefail

K3S="k3s"
NS="giomartins"
ACAO="${1:?uso: $0 <copiar|validar> <postgres|vaultwarden>}"
SVC="${2:?uso: $0 <copiar|validar> <postgres|vaultwarden>}"

case "$SVC" in
  postgres)    VOL="apps_postgres_data";   PVC="postgres-data" ;;
  vaultwarden) VOL="vaultwarden_data";     PVC="vaultwarden-data" ;;
  *) echo "serviço desconhecido: $SVC" >&2; exit 1 ;;
esac

ORIGEM="/var/lib/docker/volumes/${VOL}/_data"

destino() {
  $K3S kubectl get pv -o json 2>/dev/null | python3 -c "
import json,sys
for pv in json.load(sys.stdin)['items']:
    if pv['spec'].get('claimRef',{}).get('name')=='$PVC':
        print(pv['spec']['local']['path'])
"
}

if [ "$ACAO" = "copiar" ]; then
  DESTINO=$(destino)
  [ -z "$DESTINO" ] && { echo "erro: PVC $PVC sem PV (Bound?)" >&2; exit 1; }
  [ -d "$ORIGEM" ] || { echo "erro: volume $ORIGEM nao existe" >&2; exit 1; }

  # O filler precisa sair: ele monta o mesmo PVC, e o `local-path` nao impede
  # dois monts RWO no mesmo no, mas o pod do app nao subiria enquanto ele existir
  # (o Deployment espera o PVC, nao o filler -- por isso sai agora).
  echo "[1/5] removendo filler (se existir)"
  $K3S kubectl delete pod "pvc-filler-${SVC}" -n "$NS" --ignore-not-found --wait=false >/dev/null 2>&1

  echo "[2/5] parando container $SVC"
  docker stop "$SVC" >/dev/null || { echo "erro ao parar" >&2; exit 1; }

  echo "[3/5] copiando $ORIGEM -> $DESTINO"
  # `/.` copia o CONTEUDO, nao o diretorio. Sem isso ficaria $DESTINO/_data e o
  # Postgres nao acharia PG_VERSION.
  cp -a "${ORIGEM}/." "$DESTINO/" || {
    echo "erro na copia; religando $SVC" >&2
    docker start "$SVC" >/dev/null
    exit 1
  }

  echo "[4/5] religando container $SVC (rollback de pe)"
  docker start "$SVC" >/dev/null

  echo "[5/5] resultado"
  echo "  destino: $(du -sh "$DESTINO" 2>/dev/null | cut -f1)"
  echo "  origem:  $(du -sh "$ORIGEM" 2>/dev/null | cut -f1)"
  echo "  itens:   $(ls -A "$DESTINO" 2>/dev/null | wc -l)"
  exit 0
fi

if [ "$ACAO" = "validar" ]; then
  if [ "$SVC" = "postgres" ]; then
    echo "=== validando postgres ==="
    echo "-- PVC --"
    $K3S kubectl get pvc postgres-data -n "$NS" --no-headers
    echo "-- pod --"
    $K3S kubectl get pod -n "$NS" -l app.kubernetes.io/name=postgres --no-headers
    POD=$($K3S kubectl get pod -n "$NS" -l app.kubernetes.io/name=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$POD" ]; then
      echo "-- pg_isready --"
      $K3S kubectl exec -n "$NS" "$POD" -- pg_isready -U domain -d domain 2>&1
      echo "-- versao --"
      $K3S kubectl exec -n "$NS" "$POD" -- psql -U domain -d domain -tAc "select version()" 2>&1 | head -1
      echo "-- tabelas --"
      $K3S kubectl exec -n "$NS" "$POD" -- psql -U domain -d domain -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>&1
      echo "-- audit_log --"
      $K3S kubectl exec -n "$NS" "$POD" -- psql -U domain -d domain -tAc "select count(*) from audit_log" 2>&1
      echo "-- finance_transactions md5 --"
      $K3S kubectl exec -n "$NS" "$POD" -- psql -U domain -d domain -tAc "select count(*)||'|'||md5(string_agg(t::text,'|' order by t.id)) from finance_transactions t" 2>&1
    fi
  else
    echo "=== validando vaultwarden ==="
    $K3S kubectl get pvc vaultwarden-data -n "$NS" --no-headers
    $K3S kubectl get pod -n "$NS" -l app.kubernetes.io/name=vaultwarden --no-headers
    POD=$($K3S kubectl get pod -n "$NS" -l app.kubernetes.io/name=vaultwarden -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$POD" ]; then
      echo "-- /alive --"
      $K3S kubectl exec -n "$NS" "$POD" -- wget -qO- http://127.0.0.1/alive 2>&1 | head -2
      echo "-- rsa_key sha256 --"
      $K3S kubectl exec -n "$NS" "$POD" -- sha256sum /data/rsa_key.pem 2>&1
      echo "-- tamanho do db --"
      $K3S kubectl exec -n "$NS" "$POD" -- ls -l /data/db.sqlite3 2>&1
    fi
  fi
  exit 0
fi

echo "acao desconhecida: $ACAO" >&2
exit 1
