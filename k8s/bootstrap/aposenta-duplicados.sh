#!/bin/bash
# aposenta-duplicados.sh — para os containers Docker que o k8s ja serve.
#
# ## Criterio de aceitacao (todos precisam valer)
#
#   1. existe equivalente no k8s respondendo AGORA (medido, nao suposto);
#   2. ZERO requisicao HTTP real nas ultimas 3h -- e "saude do proprio container"
#      nao conta como requisicao;
#   3. o host deles no ingress NAO aponta para a porta do container (a fatia 8
#      ja virou todas);
#   4. parar e reversivel: `docker start <nome>`, com `restart=no` para nao
#      ressuscitar num reboot.
#
# ## Por que `docker stop` e nao `docker rm`
#
# O container parado e o rollback. Remover e a ultima operacao da migracao
# inteira, depois de um periodo de observacao, e ela e um commit separado
# (`aposenta-docker.sh`). Nada de "ja que esta parado, apago".
set -uo pipefail

# Os que o k8s cobre e que nao tem trafego real.
#
# `alloy` NAO esta na lista, e o motivo nao e o OTLP: o pod `alloy-logs` ja
# recebe spans (provado: receiver_accepted_spans_total == exporter_sent_spans_total).
# O que ainda depende do container e o `loki.source.docker`, que le o stdout dos
# containers via `docker.sock`. Enquanto houver QUALQUER container rodando, parar
# o alloy Docker corta os logs deles. Ele sai no fim, junto com o Docker.
ALVOS="adminer excalidraw grafana loki minio prometheus tempo db-mcp db-mcp-gateway"

echo "=== 0. pre-condicoes: o k8s responde por cada um? ==="
# <container>:<url-de-prova>
CHECKS="adminer:http://127.0.0.1:30092/
grafana:http://127.0.0.1:30300/api/health
minio:http://127.0.0.1:30900/minio/health/live
db-mcp-gateway:http://127.0.0.1:30821/healthz
excalidraw:http://127.0.0.1:30023/"

FALHA=0
for par in $CHECKS; do
  c=${par%%:*}; url=${par#*:}
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url" 2>/dev/null)
  if [ "$code" = "200" ]; then
    printf "  %-16s k8s OK (%s)\n" "$c" "$code"
  else
    printf "  %-16s k8s FALHOU (%s) <-- NAO parar o Docker\n" "$c" "$code"
    FALHA=1
  fi
done
[ "$FALHA" = "0" ] || { echo; echo "ABORTADO: o k8s nao cobre todos; parar o Docker seria perda de servico"; exit 1; }

echo
echo "=== 1. ultima requisicao HTTP real de cada alvo (3h) ==="
for c in $ALVOS; do
  # Exclui o healthcheck do proprio container (Wget em ::1/localhost).
  n=$(sudo docker logs "$c" --since 3h 2>/dev/null \
      | grep -E '"(GET|POST|HEAD|PUT) /' \
      | grep -vcE '"(Wget|curl/[0-9.]+)"' || true)
  printf "  %-18s %s requisicao(oes) de terceiros\n" "$c" "$n"
  if [ "${n:-0}" -gt 0 ]; then
    echo "    ULTIMAS:"
    sudo docker logs "$c" --since 3h 2>/dev/null \
      | grep -E '"(GET|POST|HEAD|PUT) /' | grep -vE '"(Wget|curl/[0-9.]+)"' \
      | tail -2 | cut -c1-150 | sed 's/^/      /'
  fi
done

echo
echo "=== 2. parando (restart=no, para nao voltar num reboot) ==="
for c in $ALVOS; do
  sudo docker update --restart=no "$c" >/dev/null 2>&1
  if sudo docker stop "$c" >/dev/null 2>&1; then
    echo "  parado: $c ($(sudo docker inspect "$c" --format '{{.State.Status}}'))"
  else
    echo "  FALHOU: $c (continua $(sudo docker inspect "$c" --format '{{.State.Status}}'))"
  fi
done

echo
echo "=== 3. os 19 hosts continuam respondendo pelo POD do ingress? ==="
DIV=0
for h in domain vault dockhand tela-api ai minio adminer grafana rabbit evolution otel maus draw finance-api db-mcp tela hub finance rancher; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -H "Host: $h.giomartins.dev" http://127.0.0.1/ 2>/dev/null)
  case "$code" in
    000|5*) printf "  %-14s %s <-- PROBLEMA\n" "$h" "$code"; DIV=$((DIV+1));;
    *)      printf "  %-14s %s\n" "$h" "$code";;
  esac
done
echo "  hosts com problema: $DIV"

echo
echo "=== 4. containers rodando ==="
sudo docker ps --format '  {{.Names}}' 2>/dev/null | sort
echo "  total: $(sudo docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
echo "  memoria: $(free -m 2>/dev/null | sed -n '2p' | awk '{print $3" usada, "$7" disponivel"}')"

[ "$DIV" -eq 0 ] || { echo; echo "ATENCAO: $DIV host(s) com problema. Rollback: sudo docker start <nome>"; exit 1; }
echo
echo "### DUPLICADOS APOSENTADOS"
echo "rollback: sudo docker start <nome>  (e docker update --restart=unless-stopped se quiser persistir)"
