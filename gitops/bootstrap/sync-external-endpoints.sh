#!/bin/bash
# sync-external-endpoints.sh — mantém os Service/EndpointSlice do k8s apontando
# para os containers Docker que ainda não migraram.
#
# Por que isto existe: pods NÃO alcançam a rede Docker diretamente (a política
# FORWARD do iptables é DROP). A ponte é um Service sem selector + EndpointSlice
# com o IP do container — o kube-proxy faz DNAT e o tráfego passa por
# KUBE-SERVICES em vez de FORWARD.
#
# O problema: o IP não é estável. O Dockhand redeploya `project-infra` (de onde
# vêm postgres/rabbitmq/minio) e o container pode renascer com outro IP. Sem
# sincronizar, os apps no k8s param de conectar — e o ArgoCD mostra tudo verde,
# porque o Service e o Deployment estão "Synced".
#
# Isto é ponte, não destino. Morre quando os dados migrarem para o cluster
# (fatias 5 e 6 do MIGRATION.md), porque aí o Service passa a ter selector e o
# IP deixa de importar.
#
# Instalação (host):
#   sudo install -m 755 sync-external-endpoints.sh /usr/local/sbin/sync-external-endpoints.sh
#   sudo install -m 644 sync-external-endpoints.service /etc/systemd/system/
#   sudo install -m 644 sync-external-endpoints.timer   /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now sync-external-endpoints.timer
set -uo pipefail

K3S="k3s"
NS="giomartins"
# Formato: <nome-do-service-no-k8s>:<container-docker>:<porta>
MAPA=(
  "postgres:postgres:5432"
  "rabbitmq:rabbitmq:5672"
  "minio:minio:9000"
  "alloy:alloy:4318"
  "evolution-redis:evolution-redis:6379"
)

alterado=0

for entrada in "${MAPA[@]}"; do
  IFS=: read -r svc container porta <<< "$entrada"

  ip=$(docker inspect "$container" \
        --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)

  # Container ausente ou parado: não mexe no endpoint. Zerar aqui derrubaria os
  # consumidores no k8s sem necessidade — melhor deixar o último IP conhecido e
  # falhar só o que depende dele.
  if [ -z "$ip" ]; then
    echo "[skip] $container não está rodando — endpoint de $svc intocado"
    continue
  fi

  atual=$($K3S kubectl get endpointslice "$svc" -n "$NS" \
            -o jsonpath='{.endpoints[0].addresses[0]}' 2>/dev/null)

  if [ "$atual" = "$ip" ]; then
    continue
  fi

  echo "[sync] $svc: ${atual:-<vazio>} -> $ip"

  # EndpointSlice pode não existir na primeira execução; o apply cobre os dois
  # casos e é idempotente.
  cat <<YAML | $K3S kubectl apply -f - >/dev/null
apiVersion: v1
kind: Service
metadata:
  name: ${svc}
  namespace: ${NS}
  labels:
    app.kubernetes.io/part-of: giomartins
    giomartins.dev/bridge: docker
spec:
  ports:
    - name: ${svc}
      port: ${porta}
      targetPort: ${porta}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: ${svc}
  namespace: ${NS}
  labels:
    kubernetes.io/service-name: ${svc}
    giomartins.dev/bridge: docker
addressType: IPv4
ports:
  - name: ${svc}
    port: ${porta}
    protocol: TCP
endpoints:
  - addresses:
      - "${ip}"
    conditions:
      ready: true
YAML

  alterado=1
done

# Revalida do lado de dentro de um pod: um IP certo no EndpointSlice não prova
# que o caminho funciona. Só loga, não falha o timer.
if [ "$alterado" = "1" ]; then
  echo "[info] endpoints alterados; conexões existentes podem precisar reconectar"
fi
