#!/bin/bash
# corta-alloy-state-p2.sh — fase 2: o Deployment precisa NASCER com Recreate.
#
# ## Por que deletar, e nao patch
#
# A armadilha 11 do README, ao vivo: o Deployment existente foi criado como
# RollingUpdate, a API defaultou `maxSurge: 25%`/`maxUnavailable: 25%` no
# `spec.strategy.rollingUpdate`, e esse campo sobrevive quando o manifesto muda
# `type` para `Recreate`. O ArgoCD tenta aplicar e a API recusa:
#
#   Deployment.apps "alloy-logs" is invalid: spec.strategy.rollingUpdate:
#   Forbidden: may not be specified when strategy `type` is 'Recreate'
#
# `rollingUpdate: null` nao resolve (SSA ignora null) e `patch --type=json` com
# `op: remove` a API re-defaulta no mesmo instante. A saida e' DELETAR e deixar o
# ArgoCD recriar: um Deployment novo nasce sem o campo defaultado.
#
# ## Por que deletar e' seguro AQUI
#
# O PVC `alloy-state` ja esta Bound, Retain, e semeado com as posicoes (fase 1).
# O que se perde no delete e' so a coleta por ~10s. `replicas: 1` -> o ArgoCD
# recria com o PVC montado.
#
# O Service `alloy` (OTLP 4317/4318) fica sem endpoints nesse intervalo. Os
# apps tem retry; o `domain-worker` ja mostrou que sobrevive a `connection
# reset` e reenvia no ciclo seguinte.
set -uo pipefail
K="sudo k3s kubectl"
NS=observability

echo "UTC: $(date -u)"
echo
echo "=== 0. pre-condicoes ==="
ph=$($K get pvc alloy-state -n $NS -o jsonpath='{.status.phase}')
echo "  PVC alloy-state: $ph"
[ "$ph" = "Bound" ] || { echo "  ABORTADO: PVC nao esta Bound"; exit 1; }
PV=$($K get pvc alloy-state -n $NS -o jsonpath='{.spec.volumeName}')
echo "  reclaimPolicy: $($K get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}')"
echo "  posicoes no PV (lidas pelo host):"
sudo find "/var/lib/rancher/k3s/storage/$(basename "$($K get pv "$PV" -o jsonpath='{.spec.local.path}')")" \
  -name positions.yml -exec sh -c 'echo "    $1: $(wc -l < "$1") linhas"' _ {} \; 2>/dev/null

echo
echo "=== 1. revision atual do Deployment (rollback) ==="
$K get deploy alloy-logs -n $NS -o jsonpath='  strategy={.spec.strategy.type} replicas={.spec.replicas}{"\n"}'
$K get deploy alloy-logs -n $NS -o yaml > /tmp/alloy-deploy-backup.yaml 2>/dev/null
echo "  backup: /tmp/alloy-deploy-backup.yaml ($(wc -l < /tmp/alloy-deploy-backup.yaml) linhas)"

echo
echo "=== 2. deletando o Deployment (o ArgoCD recria do git) ==="
$K delete deploy alloy-logs -n $NS 2>&1 | sed 's/^/  /'

echo
echo "=== 3. esperando o ArgoCD recriar ==="
for i in $(seq 1 40); do
  st=$($K get deploy alloy-logs -n $NS -o jsonpath='{.spec.strategy.type}' 2>/dev/null)
  if [ "$st" = "Recreate" ]; then echo "  recriado com strategy=$st em $((i*3))s"; break; fi
  sleep 3
done
[ "${st:-}" = "Recreate" ] || { echo "  ATENCAO: strategy=${st:-ausente} -- forcar refresh do ArgoCD"; $K annotate application observability -n argocd argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1; sleep 15; $K get deploy alloy-logs -n $NS -o jsonpath='  agora: strategy={.spec.strategy.type}{"\n"}'; }

echo
echo "=== 4. o pod novo monta o PVC? ==="
for i in $(seq 1 40); do
  P=$($K get pods -n $NS -l app.kubernetes.io/name=alloy-logs -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  rdy=$($K get pod -n $NS "$P" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null)
  [ "$rdy" = "true" ] && { echo "  pod=$P ready em $((i*3))s"; break; }
  sleep 3
done
vol=$($K get pod -n $NS "$P" -o jsonpath='{range .spec.volumes[?(@.name=="state")]}{.emptyDir}{.persistentVolumeClaim.claimName}{end}')
echo "  volume 'state' = ${vol:-<nenhum>}"
case "$vol" in
  alloy-state) echo "  OK: montou o PVC semeado" ;;
  *) echo "  PROBLEMA: volume nao e' o PVC (foi '$vol')" ;;
esac

echo
echo "=== 5. posicoes sobreviveram? ==="
$K exec -n $NS "$P" -- sh -c 'ls -l /var/lib/alloy/data/*/positions.yml' 2>&1 | sed 's/^/  /'
echo "  (60 linhas no docker + 70+ no kubernetes = seed preservado; arquivos de 1-2 linhas = vazio)"

echo
echo "=== 6. descarte parou? (90s de trafego) ==="
$K get --raw "/api/v1/namespaces/$NS/pods/$P:12345/proxy/metrics" > /tmp/am-antes2.txt 2>/dev/null
s1=$(grep '^loki_write_sent_entries_total' /tmp/am-antes2.txt | awk '{print $NF}')
d1=$(grep 'loki_write_dropped_entries_total.*ingester_error' /tmp/am-antes2.txt | awk '{print $NF}')
sleep 90
$K get --raw "/api/v1/namespaces/$NS/pods/$P:12345/proxy/metrics" > /tmp/am-depois2.txt 2>/dev/null
s2=$(grep '^loki_write_sent_entries_total' /tmp/am-depois2.txt | awk '{print $NF}')
d2=$(grep 'loki_write_dropped_entries_total.*ingester_error' /tmp/am-depois2.txt | awk '{print $NF}')
echo "  enviadas:    ${s1:-?} -> ${s2:-?}  (delta $(( ${s2:-0} - ${s1:-0} )))"
echo "  descartadas: ${d1:-?} -> ${d2:-?}  (delta $(( ${d2:-0} - ${d1:-0} )))"
if [ "${d2:-0}" = "${d1:-0}" ] && [ $(( ${s2:-0} - ${s1:-0} )) -gt 0 ]; then
  echo "  ### SUCESSO: logs fluindo, zero descarte em 90s"
else
  echo "  ### ATENCAO: ver /tmp/am-depois2.txt"
fi

echo
echo "=== 7. OTLP segue chegando? ==="
grep -E '^otelcol_receiver_accepted_spans_total|^otelcol_receiver_accepted_metric_points_total' /tmp/am-depois2.txt | sed 's/^/  /'
echo
echo "=== 8. nada mais fora de Running? ==="
$K get pods -A --no-headers 2>/dev/null | grep -vE 'Running|Completed' | grep -vE 'kube-system|cattle|argocd|kubero|ingress-nginx|cert-manager' | sed 's/^/  /' || echo "  nenhum"
