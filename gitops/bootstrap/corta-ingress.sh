#!/bin/bash
# corta-ingress.sh — troca o nginx Docker pelo pod do k8s na porta 80.
#
# ## A forma do corte, e por que ela não tem "janela"
#
# Os dois nginx servem o MESMO arquivo (sha256 idêntico), na MESMA netns
# (`hostNetwork`), com o MESMO binário. A paridade já foi provada host a host:
# os 19 deram o mesmo status na 80 e na 8080, e 18 deram o mesmo corpo
# (o `adminer` varia por nonce/CSRF na mesma porta — provado).
#
# Ainda assim há um instante de indisponibilidade: dois processos não podem
# publicar a 80. A ordem minimiza:
#
#   1. `docker stop ingress` (para de aceitar);
#   2. `kubectl delete pod` + esperar Ready (o Deployment é `replicas: 1`);
#   3. provar os 19 hosts na 80;
#   4. se qualquer um falhar, `docker start ingress` — e o pod é apagado.
#
# ## Por que o Deployment já está com replicas: 1 ANTES
#
# O ArgoCD precisa ter sincronizado o commit do corte. Se ele estiver em
# `replicas: 0`, parar o container deixa a 80 sem dono (o mesmo incidente do
# registry). Este script espera o estado do CLUSTER, não o git.
#
# Enquanto o container Docker está no ar, o pod do ingress NÃO consegue subir
# ("bind() to 0.0.0.0:80 failed") — o que é a trava, não um bug. É por isso que
# o passo 2 apaga o pod: zera o backoff do kubelet.
set -uo pipefail
K="k3s kubectl"
NS="support"
DEP="ingress"

HOSTS="domain vault dockhand tela-api ai minio adminer grafana rabbit evolution otel maus draw finance-api db-mcp tela hub finance rancher"

restaura() {
  echo
  echo "### FALHOU: $*"
  echo "  religando o container Docker"
  sudo docker start "$DEP" >/dev/null 2>&1
  $K delete pod -n "$NS" -l app.kubernetes.io/name=ingress --ignore-not-found >/dev/null 2>&1
  sleep 4
  echo "  container: $(sudo docker inspect "$DEP" --format '{{.State.Status}}' 2>/dev/null || echo '?')"
  echo "  porta 80: $(sudo ss -lntp 2>/dev/null | grep -c ':80 ' || true) listener(s)"
  echo "  domain -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: domain.giomartins.dev' http://127.0.0.1/)"
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

echo
echo "=== 2. parando o container Docker (libera a 80) ==="
echo "  antes: $(sudo docker inspect "$DEP" --format '{{.State.Status}}' 2>/dev/null || echo '?')"
sudo docker stop "$DEP" >/dev/null || restaura "docker stop falhou"
for _ in $(seq 1 30); do
  sudo ss -lntp 2>/dev/null | grep -q ':80 ' || break
  sleep 1
done
sudo ss -lntp 2>/dev/null | grep -q ':80 ' && restaura "a 80 continua ocupada"
echo "  porta 80 livre"

echo
echo "=== 3. pod do ingress: apaga o que está em backoff e espera Ready ==="
$K delete pod -n "$NS" -l app.kubernetes.io/name=ingress --ignore-not-found --wait=true >/dev/null 2>&1
$K rollout status "deploy/$DEP" -n "$NS" --timeout=120s || {
  $K get pods -n "$NS" -l app.kubernetes.io/name=ingress -o wide | sed 's/^/    /'
  $K logs -n "$NS" -l app.kubernetes.io/name=ingress --tail=15 2>&1 | sed 's/^/    /'
  restaura "o pod do ingress não ficou Ready"
}
$K get pods -n "$NS" -l app.kubernetes.io/name=ingress -o wide | sed 's/^/  /'

echo
echo "=== 4. quem é dono da 80? ==="
sudo ss -lntp 2>/dev/null | grep ':80 ' | sed 's/^/  /'
sudo docker inspect "$DEP" --format '  container: {{.State.Status}}'

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
echo "=== 6. um corpo real, e nao so status (vault /api/config) ==="
a=$(curl -s --max-time 10 -H 'Host: vault.giomartins.dev' http://127.0.0.1/api/config | sha256sum | cut -c1-16)
echo "  sha256 do /api/config: $a"

echo
echo "### CORTE DO INGRESS CONCLUÍDO"
echo "rollback: sudo docker start ingress && $K delete pod -n support -l app.kubernetes.io/name=ingress"
