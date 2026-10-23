#!/bin/bash
# corta-ingress.sh — troca o nginx Docker pelo pod do k8s na porta 80.
#
# ## Duas armadilhas que a primeira tentativa pagou para descobrir
#
# 1. **O k8s injeta `hostPort: 80` sozinho.** O manifesto declara só
#    `containerPort: 80`, mas com `hostNetwork: true` o apiserver preenche
#    `hostPort` igual ao `containerPort`. Consequência: o SCHEDULER recusa
#    agendar o pod enquanto o container Docker segura a 80 ("1 node(s) didn't
#    have free ports"). Isso é uma trava melhor que qualquer `ss` — mas significa
#    que o pod fica `Pending`, e não em `CrashLoop`, antes do corte.
#
# 2. **`docker stop` não é instantâneo, e `ss` não distingue donos.** A versão
#    anterior rodava `docker stop` e esperava 30 s a porta 80 "ficar livre". Ela
#    não ficou, o script concluiu "porta ocupada" e religou o Docker — quando o
#    que faltava era o container TERMINAR de sair. O gate correto é o estado do
#    container (`docker inspect .State.Running == false`), não o socket.
#
# ## A ordem
#
#   0. espera o ArgoCD sincronizar `replicas: 1` (estado do CLUSTER, não do git);
#   1. mede os 19 hosts na 80 (baseline);
#   2. `docker stop` e ESPERA `.State.Running == false` (até 120 s);
#   3. apaga o pod (que estava `Pending` por falta de porta) e espera `Ready`;
#   4. mede os 19 hosts e compara com o baseline;
#   5. qualquer divergência -> rollback: apaga o pod e só então `docker start`.
#
# O rollback apaga o pod ANTES de religar o Docker porque, na ordem inversa, o
# Docker não conseguiria publicar a 80 (o pod a tem) e voltaria a falhar.
set -uo pipefail
K="k3s kubectl"
NS="support"
DEP="ingress"

HOSTS="domain vault dockhand tela-api ai minio adminer grafana rabbit evolution otel maus draw finance-api db-mcp tela hub finance rancher"

docker_rodando() {
  [ "$(sudo docker inspect "$DEP" --format '{{.State.Running}}' 2>/dev/null)" = "true" ]
}

restaura() {
  echo
  echo "### FALHOU: $*"
  echo "  rollback: apagando o pod primeiro (ele pode deter a 80)"
  $K delete pod -n "$NS" -l app.kubernetes.io/name=ingress --ignore-not-found --wait=true >/dev/null 2>&1
  for _ in $(seq 1 30); do
    $K get pods -n "$NS" -l app.kubernetes.io/name=ingress --no-headers 2>/dev/null | grep -q . || break
    sleep 2
  done
  echo "  religando o container Docker"
  sudo docker start "$DEP" >/dev/null 2>&1
  sleep 4
  echo "  container: $(sudo docker inspect "$DEP" --format '{{.State.Status}}' 2>/dev/null || echo '?')"
  for h in domain vault ai draw; do
    echo "  $h -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $h.giomartins.dev" http://127.0.0.1/)"
  done
  exit 1
}

echo "=== 0. esperando o ArgoCD sincronizar o corte (replicas: 1) ==="
OK=0
for i in $(seq 1 60); do
  rep=$($K get deploy "$DEP" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)
  if [ "$rep" = "1" ]; then OK=1; break; fi
  [ $((i % 10)) -eq 0 ] && echo "  ... replicas=$rep (aguardando o ArgoCD)"
  sleep 5
done
[ "$OK" = "1" ] || restaura "o ArgoCD não sincronizou replicas: 1 em 5 min"
echo "  deployment no cluster: replicas=1"

echo
echo "=== 1. baseline ANTES de tocar em nada (porta 80) ==="
for h in $HOSTS; do
  r=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $h.giomartins.dev" http://127.0.0.1/ 2>/dev/null)
  echo "$h $r"
done > /tmp/ing-baseline.txt
echo "  $(wc -l < /tmp/ing-baseline.txt | tr -d ' ') hosts medidos"
docker_rodando && echo "  container Docker: running (dono da 80)"

echo
echo "=== 2. parando o container Docker e ESPERANDO ele sair ==="
sudo docker stop "$DEP" >/dev/null || restaura "docker stop falhou"
docker_rodando && restaura "o container continua running depois de 10 s de docker stop"
for i in $(seq 1 60); do
  docker_rodando || break
  [ $((i % 10)) -eq 0 ] && echo "  ... ainda saindo (${i}s)"
  sleep 2
done
docker_rodando && restaura "o container não terminou em 120 s"
echo "  container: $(sudo docker inspect "$DEP" --format '{{.State.Status}}')"
echo "  dono da 80 agora: $(sudo ss -lntpH 2>/dev/null | grep ':80 ' | head -1 || echo 'ninguém')"

echo
echo "=== 3. apagando o pod (estava Pending por falta de porta) e esperando Ready ==="
$K delete pod -n "$NS" -l app.kubernetes.io/name=ingress --ignore-not-found --wait=true >/dev/null 2>&1
$K rollout status "deploy/$DEP" -n "$NS" --timeout=150s || {
  $K get pods -n "$NS" -l app.kubernetes.io/name=ingress -o wide | sed 's/^/    /'
  $K logs -n "$NS" -l app.kubernetes.io/name=ingress --tail=12 2>&1 | sed 's/^/    /'
  restaura "o pod do ingress não ficou Ready"
}
$K get pods -n "$NS" -l app.kubernetes.io/name=ingress -o wide | sed 's/^/  /'

echo
echo "=== 4. quem é dono da 80? ==="
for pid in $(sudo ss -lntpH 2>/dev/null | grep ':80 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  cg=$(sudo cat /proc/$pid/cgroup 2>/dev/null | head -1)
  case "$cg" in
    *kubepods*) echo "  pid $pid -> POD (k8s)   <-- esperado";;
    *docker-*)  echo "  pid $pid -> DOCKER       <-- errado";;
    *)          echo "  pid $pid -> OUTRO";;
  esac
done

echo
echo "=== 5. os 19 hosts DEPOIS (porta 80) ==="
DIV=0
for h in $HOSTS; do
  r=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -H "Host: $h.giomartins.dev" http://127.0.0.1/ 2>/dev/null)
  esperado=$(grep "^$h " /tmp/ing-baseline.txt | awk '{print $2}')
  if [ "$r" = "$esperado" ]; then
    printf "  %-14s %s (igual)\n" "$h" "$r"
  else
    printf "  %-14s %s (ERA %s) <-- DIVERGE\n" "$h" "$r" "$esperado"
    DIV=$((DIV+1))
  fi
done
echo
echo "hosts divergentes: $DIV"
[ "$DIV" -eq 0 ] || restaura "$DIV host(s) divergiram do baseline"

echo
echo "=== 6. um corpo real, e não só status (vault /api/config) ==="
echo "  sha256: $(curl -s --max-time 10 -H 'Host: vault.giomartins.dev' http://127.0.0.1/api/config | sha256sum | cut -c1-16)"

echo
echo "=== 7. um host que NÃO é servido pelo nginx (registry :5000) continua ok? ==="
curl -s -o /dev/null -w '  registry :5000 -> %{http_code}\n' --max-time 10 http://registry.giomartins.dev:5000/v2/

echo
echo "### CORTE DO INGRESS CONCLUÍDO"
echo "rollback: $K delete pod -n support -l app.kubernetes.io/name=ingress && sudo docker start ingress"
