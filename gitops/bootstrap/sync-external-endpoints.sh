#!/bin/bash
# sync-external-endpoints.sh — mantém os EndpointSlices do k8s apontando para os
# containers Docker que ainda não migraram.
#
# Por que isto existe: pods NÃO alcançam a rede Docker diretamente (a política
# FORWARD do iptables é DROP). A ponte é um Service sem selector + EndpointSlice
# com o IP do container — o kube-proxy faz DNAT e o tráfego passa por
# KUBE-SERVICES em vez de FORWARD.
#
# ## Divisão de responsabilidade (importante)
#
#   - Os **Services** (postgres, rabbitmq, minio, alloy, evolution-*) são
#     declarados em gitops/apps/bridges/ e reconciliados pelo ArgoCD.
#   - Os **EndpointSlices** são escritos POR ESTE SCRIPT. Eles contêm o IP do
#     container, que muda quando o Dockhand redeploya a stack.
#
# O script NÃO cria nem altera Services. Se criasse, o ArgoCD (com selfHeal
# ligado) os reverteria, e os dois ficariam brigando em loop.
#
# O problema que isto resolve: o Dockhand redeploya `project-infra` por git-sync
# agendado, o postgres renasce com outro IP, e os apps no k8s param de conectar
# — com o ArgoCD mostrando tudo `Synced/Healthy`, porque Deployment e Service
# não têm nada de errado. O erro só apareceria no log da aplicação.
#
# Isto é ponte, não destino. Morre quando os dados migrarem para o cluster
# (fatias 5 e 6 do MIGRATION.md).
#
# Instalação (host):
#   sudo install -m 755 sync-external-endpoints.sh /usr/local/sbin/
#   sudo install -m 644 sync-external-endpoints.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now sync-external-endpoints.timer
set -uo pipefail

K3S="k3s"
NS="giomartins"

# <nome-do-service-no-k8s>:<container-docker>:<porta>
MAPA=(
  "postgres:postgres:5432"
  "rabbitmq:rabbitmq:5672"
  "minio:minio:9000"
  "alloy:alloy:4318"
  "evolution-redis:evolution-redis:6379"
  "evolution-api:evolution-api:8080"
  "vaultwarden:vaultwarden:80"
)

for entrada in "${MAPA[@]}"; do
  IFS=: read -r svc container porta <<< "$entrada"

  ip=$(docker inspect "$container" \
        --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)

  # Container ausente ou parado: NÃO mexe no endpoint. Zerar aqui derrubaria os
  # consumidores no k8s sem necessidade — melhor manter o último IP conhecido e
  # deixar falhar só o que depende dele. Um `[skip]` no journal é o sinal.
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

  # `kubectl apply` num EndpointSlice exige o campo `ports`; ele é o mesmo do
  # Service, mas precisa estar aqui porque o EndpointSlice é um objeto
  # independente (o Service não o gera, já que não tem selector).
  cat <<YAML | $K3S kubectl apply -f - >/dev/null
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
done
