#!/bin/bash
# prova-restart-alloy.sh — a prova que importa: reiniciar o pod e ver se as
# posicoes sobrevivem.
#
# ## Por que reiniciar e' o unico teste valido
#
# O pod atual nao reiniciou desde que subiu com o PVC. "Nao descartou em 12
# minutos" prova que funciona em regime, nao que o restart preserva o estado --
# que e' exatamente o que o `emptyDir` quebrava. O bug original so' aparecia
# DEPOIS de um restart.
#
# Antes do conserto, o pod voltava lendo o log Docker do byte zero, mandava
# linhas de 19/10 e o Loki respondia 400 -> `dropping data`. Se o PVC esta'
# fazendo o trabalho, o pod novo retoma do offset salvo e o contador de descarte
# fica em zero.
set -uo pipefail
K="sudo k3s kubectl"
NS=observability

echo "UTC: $(date -u)"
P=$($K get pods -n $NS -l app.kubernetes.io/name=alloy-logs -o jsonpath='{.items[0].metadata.name}')
echo "pod antes: $P"

echo
echo "=== 1. baseline ==="
# ## Por que a testemunha e' CONTAGEM DE LINHAS, e nao md5
#
# `positions.yml` e' reescrito a cada linha nova que o Alloy le -- o offset muda
# a cada segundo. Comparar o md5 antes/depois do restart da' diferente SEMPRE,
# mesmo quando o PVC funcionou perfeitamente, e o gate acusaria falha num
# conserto correto. (Esse erro ja' custou um gate falso na fase 1 deste
# procedimento.)
#
# O que distingue "PVC funcionou" de "PVC vazio" nao e' o hash, e' a ORDEM DE
# GRANDEZA: com o PVC, ~61 streams no Docker e ~73+ no Kubernetes; vazio, 1 ou
# 2 linhas (o cabecalho `positions:` e talvez uma entrada nova).
LIN_D=$($K exec -n $NS "$P" -- sh -c 'wc -l < /var/lib/alloy/data/loki.source.docker.containers/positions.yml' 2>/dev/null | tr -d ' ')
LIN_K=$($K exec -n $NS "$P" -- sh -c 'wc -l < /var/lib/alloy/data/loki.source.kubernetes.pods/positions.yml' 2>/dev/null | tr -d ' ')
$K get --raw "/api/v1/namespaces/$NS/pods/$P:12345/proxy/metrics" > /tmp/b1.txt 2>/dev/null
S1=$(grep '^loki_write_sent_entries_total' /tmp/b1.txt | awk '{print $NF}')
D1=$(grep 'loki_write_dropped_entries_total.*ingester_error' /tmp/b1.txt | awk '{print $NF}')
echo "  posicoes: docker=${LIN_D} linhas, kubernetes=${LIN_K} linhas"
echo "  enviadas=${S1} descartadas=${D1}"

echo
echo "=== 2. deletando o pod (o Deployment recria; PVC fica) ==="
$K delete pod "$P" -n $NS --wait=false 2>&1 | sed 's/^/  /'

echo
echo "=== 3. esperando o pod novo ficar Ready ==="
for i in $(seq 1 40); do
  N=$($K get pods -n $NS -l app.kubernetes.io/name=alloy-logs -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  [ "$N" != "$P" ] || { sleep 2; continue; }
  r=$($K get pod -n $NS "$N" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null)
  [ "$r" = "true" ] && { echo "  pod novo: $N ready em $((i*2))s"; break; }
  sleep 2
done

echo
echo "=== 4. as posicoes continuam populadas? ==="
ND=$($K exec -n $NS "$N" -- sh -c 'wc -l < /var/lib/alloy/data/loki.source.docker.containers/positions.yml' 2>/dev/null | tr -d ' ')
NK=$($K exec -n $NS "$N" -- sh -c 'wc -l < /var/lib/alloy/data/loki.source.kubernetes.pods/positions.yml' 2>/dev/null | tr -d ' ')
echo "  docker=${ND} linhas (antes: ${LIN_D})"
echo "  kubernetes=${NK} linhas (antes: ${LIN_K})"
if [ "${ND:-0}" -ge 30 ] && [ "${NK:-0}" -ge 30 ]; then
  echo "  OK: PVC preservou (vazio teria 1-2 linhas)"
else
  echo "  PROBLEMA: posicoes parecem vazias"
fi

echo
echo "=== 5. o descarte voltou? (120s de trafego) ==="
sleep 120
$K get --raw "/api/v1/namespaces/$NS/pods/$N:12345/proxy/metrics" > /tmp/b2.txt 2>/dev/null
S2=$(grep '^loki_write_sent_entries_total' /tmp/b2.txt | awk '{print $NF}')
D2=$(grep 'loki_write_dropped_entries_total.*ingester_error' /tmp/b2.txt | awk '{print $NF}')
echo "  enviadas=${S2} descartadas=${D2}  (contadores do pod NOVO)"
echo "  log de descarte: $($K logs -n $NS "$N" 2>/dev/null | grep -c 'dropping data' || true) linha(s)"

if [ "${D2:-1}" = "0" ] && [ $($K logs -n $NS "$N" 2>/dev/null | grep -c 'dropping data' || echo 1) -eq 0 ]; then
  echo "  ### SUCESSO: reiniciou, retomou do offset salvo, zero descarte"
else
  echo "  ### FALHOU: o PVC nao preservou as posicoes"
  echo "  rollback: reverter alloy-logs.yaml para emptyDir e reaplicar"
fi

echo
echo "=== 6. OTLP segue chegando no pod novo ==="
grep -E '^otelcol_receiver_accepted_spans_total|^otelcol_receiver_accepted_metric_points_total|^otelcol_exporter_sent_spans_total' /tmp/b2.txt | sed 's/^/  /'
echo
echo "=== 7. Service alloy com endpoint? ==="
$K get endpoints alloy -n $NS 2>/dev/null | sed 's/^/  /'
