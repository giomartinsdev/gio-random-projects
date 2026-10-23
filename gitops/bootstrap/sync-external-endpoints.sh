#!/bin/bash
# sync-external-endpoints.sh — mantém os EndpointSlices do k8s apontando para os
# containers Docker que ainda não migraram.
#
# ## O problema
#
# Pods NÃO alcançam a rede Docker diretamente: a política `FORWARD` do iptables
# é `DROP`. Verificado de dentro de um pod — `172.18.0.16:5432` e
# `172.18.0.1:5432` dão timeout, embora o host alcance o postgres normalmente.
#
# A ponte é um Service sem selector + EndpointSlice com o IP do container. O
# kube-proxy faz DNAT na saída do pod e o pacote passa por `KUBE-SERVICES` em
# vez de `FORWARD`.
#
# ## A armadilha que custou uma madrugada
#
# O kube-proxy só liga uma porta do EndpointSlice a uma porta do Service quando
# **os nomes são idênticos** — não basta a porta numérica casar. Sintoma: o
# Service existe, o EndpointSlice existe, o IP está certo, o ArgoCD diz
# `Synced/Healthy`, e o pod leva `connection refused`.
#
# Aconteceu exatamente isso: o Service declarava `name: amqp` (porta 5672) e o
# EndpointSlice dizia `name: rabbitmq`. Nenhuma regra de iptables era criada
# para aquele ClusterIP. Só o `postgres` funcionava, porque por coincidência os
# dois lados se chamavam `postgres`.
#
# Por isso este script **lê o nome e o número da porta do próprio Service** em
# vez de receber os dois por parâmetro. Assim o nome não pode divergir: ele é
# copiado da única fonte da verdade.
#
# ## Divisão de responsabilidade
#
#   - **Services** (postgres, alloy, evolution-redis) são declarados em
#     `gitops/apps/bridges/` (ou no diretório do app, no caso do vaultwarden
#     até 2026-10-23) e reconciliados pelo ArgoCD.
#   - **EndpointSlices** são escritos POR ESTE SCRIPT. Eles contêm o IP do
#     container, que muda quando o Dockhand redeploya a stack.
#
# O script NÃO cria nem altera Services. Se criasse, o ArgoCD (com `selfHeal`
# ligado) os reverteria e os dois brigariam em loop.
#
# ## Por que isto existe
#
# O Dockhand redeploya `project-infra` por git-sync agendado. O postgres renasce
# com outro IP e os apps no k8s param de conectar — com o ArgoCD mostrando tudo
# `Synced/Healthy`, porque Deployment e Service não têm nada de errado. O erro
# só apareceria no log da aplicação.
#
# Isto é ponte, não destino. Morre quando os dados migrarem para o cluster
# (fatias 5 e 6 do MIGRATION.md).
#
# ## Instalação (host)
#
#   sudo install -m 755 sync-external-endpoints.sh /usr/local/sbin/
#   sudo install -m 644 sync-external-endpoints.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now sync-external-endpoints.timer
set -uo pipefail

K3S="k3s"
NS="giomartins"

# <service-no-k8s>:<container-docker>
#
# A porta NÃO aparece aqui de propósito: vem do Service. Ver o comentário do
# topo sobre nomes de porta.
#
# VAZIO desde 2026-10-23. Não há mais nenhum Service de ponte: `postgres` e
# `vaultwarden` saíram na fatia 6, `alloy` e `evolution-redis` em 2026-10-23.
#
# O timer continua instalado e roda a cada minuto sem fazer nada. Não é
# desleixo: é a rede de segurança do estado atual. Se um Service de ponte
# reaparecer (rollback de emergência), basta acrescentar a linha de volta e
# `systemctl restart`. Com o Docker desligado, o loop não tem em que tocar --
# e o `[skip]` do journal deixa isso explícito.
#
# ## Por que cada saída foi perigosa
#
# `alloy` saiu porque o Service ganhou selector e passou a apontar para o pod
# `alloy-logs`. Deixá-lo aqui era pior que no postgres: o timer recriaria o
# EndpointSlice manual `alloy` (mesmo nome do Service) e o kube-proxy passaria a
# balancear entre o POD e o CONTAINER -- metade dos traces e métricas indo para
# o Tempo/Prometheus em Docker, a outra metade para os do cluster. Sintoma mudo:
# os dois aceitam OTLP (200), e o dado simplesmente some do Grafana pela metade.
#
# `postgres` saiu em 2026-10-23 e `vaultwarden` em 2026-10-23: os dois Services
# ganharam selector e o EndpointSlice do controller passou a ser a fonte. No
# vaultwarden o sintoma foi mudo (os dois respondem o mesmo /api/config); no
# postgres seria pior: escritas indo para dois bancos diferentes.
#
# `evolution-redis` saiu em 2026-10-23 pelo mesmo motivo, com um agravante: o
# dado é a sessão Baileys. Balancear entre pod e container faria o
# evolution-api escrever `pre-key-*` em dois Redis diferentes, e o hash de 860
# campos divergiria sem erro nenhum -- só um QR novo no dia seguinte.
MAPA=()

for entrada in "${MAPA[@]}"; do
  IFS=: read -r svc container <<< "$entrada"

  ip=$(docker inspect "$container" \
        --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)

  # Container ausente ou parado: NÃO mexe no endpoint. Zerar aqui derrubaria os
  # consumidores no k8s sem necessidade — melhor manter o último IP conhecido e
  # deixar falhar só o que depende dele. Um `[skip]` no journal é o sinal.
  if [ -z "$ip" ]; then
    echo "[skip] $container não está rodando — endpoint de $svc intocado"
    continue
  fi

  # Nome e número da porta vêm do Service: fonte única da verdade. Se o Service
  # ainda não existe (primeiro minuto após um push), pula sem inventar.
  porta_nome=$($K3S kubectl get svc "$svc" -n "$NS" \
                 -o jsonpath='{.spec.ports[0].name}' 2>/dev/null)
  porta_num=$($K3S kubectl get svc "$svc" -n "$NS" \
                 -o jsonpath='{.spec.ports[0].port}' 2>/dev/null)

  if [ -z "$porta_num" ]; then
    echo "[skip] Service $svc ainda não existe — nada a fazer"
    continue
  fi

  atual=$($K3S kubectl get endpointslice "$svc" -n "$NS" \
            -o jsonpath='{.endpoints[0].addresses[0]}' 2>/dev/null)
  atual_nome=$($K3S kubectl get endpointslice "$svc" -n "$NS" \
            -o jsonpath='{.ports[0].name}' 2>/dev/null)

  # Reaplica também quando o NOME da porta diverge, mesmo com o IP igual. Sem
  # isso, corrigir o nome exigiria apagar o EndpointSlice à mão — e o sintoma
  # (connection refused com tudo verde no ArgoCD) não aponta para cá.
  if [ "$atual" = "$ip" ] && [ "$atual_nome" = "$porta_nome" ]; then
    continue
  fi

  echo "[sync] $svc: ip ${atual:-<vazio>} -> $ip, porta ${atual_nome:-<vazio>} -> ${porta_nome:-<sem-nome>}/$porta_num"

  # O campo `name` do EndpointSlice PRECISA ser igual ao do Service. Ver o
  # comentário do topo. Se o Service usa porta sem nome, `name` é omitido —
  # kube-proxy casa sem nome dos dois lados.
  if [ -n "$porta_nome" ]; then
    bloco_porta="  - name: ${porta_nome}
    port: ${porta_num}
    protocol: TCP"
  else
    bloco_porta="  - port: ${porta_num}
    protocol: TCP"
  fi

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
${bloco_porta}
endpoints:
  - addresses:
      - "${ip}"
    conditions:
      ready: true
YAML
done
