#!/bin/bash
# corta-registry.sh — troca o registry Docker pelo registry do k8s na porta 5000.
#
# ## A lição que este script existe para não repetir
#
# A primeira tentativa parou o container e aplicou o manifesto com `kubectl
# apply`. O registry ficou FORA DO AR por ~2 minutos: o ArgoCD ainda estava
# sincronizado no commit anterior (`replicas: 0`) e o `selfHeal` desfez o apply
# em segundos, escalando o Deployment de volta para zero. Resultado: container
# parado, pod inexistente, porta 5000 sem dono.
#
# A regra que sai disso: **o cluster só pode divergir do git por zero segundos.**
# Este script não aplica nada por `kubectl`. Ele espera o ArgoCD — a fonte da
# verdade — reconciliar o commit do corte, e só então mexe na porta.
#
# ## A ordem, e por que cada passo é onde está
#
#   0. espera o Deployment no CLUSTER ter `replicas: 1` e `hostPort: 5000`
#      (isto é, o ArgoCD já sincronizou o commit do corte). Nesta fase o pod
#      entra em `CrashLoopBackOff` porque o container Docker ainda segura a 5000.
#      É esperado, é inofensivo, e é a prova de que o ArgoCD chegou primeiro;
#   1. para o container Docker (libera a 5000);
#   2. apaga o pod em backoff (zera o backoff exponencial do kubelet);
#   3. espera Ready;
#   4. prova com um pull real pelo NOME de produção;
#   5. se qualquer prova falhar, RELIGA o container automaticamente.
#
# ## O rollback é uma linha, e é verdade
#
# `sudo docker start registry` + apagar o pod (para liberar a 5000). O container
# e os dados dele nunca são tocados por este script.
set -uo pipefail
K="k3s kubectl"
NS="support"
DEP="registry"

falha() {
  echo
  echo "### FALHOU: $*"
  echo "  religando o container Docker para devolver o registry"
  sudo docker start registry >/dev/null 2>&1
  $K delete pod -n "$NS" -l app.kubernetes.io/name=registry --ignore-not-found >/dev/null 2>&1
  sleep 3
  echo "  container: $(sudo docker inspect "$DEP" --format '{{.State.Status}}' 2>/dev/null || echo '?')"
  echo "  porta 5000: $(sudo ss -lntp 2>/dev/null | grep -c ':5000 ' || true) listener(s)"
  exit 1
}

echo "=== 0. esperando o ArgoCD sincronizar o commit do corte ==="
# O critério é o ESTADO NO CLUSTER, não a revisão: o que importa é que o
# Deployment já peça `replicas: 1` e `hostPort: 5000`. Se o ArgoCD não chegou,
# parar o container agora repetiria o incidente.
OK=0
for i in $(seq 1 60); do
  rep=$($K get deploy "$DEP" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)
  hp=$($K get deploy "$DEP" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].ports[0].hostPort}' 2>/dev/null || echo "")
  if [ "$rep" = "1" ] && [ "$hp" = "5000" ]; then OK=1; break; fi
  [ $((i % 10)) -eq 0 ] && echo "  ... replicas=$rep hostPort=${hp:-<vazio>} (aguardando)"
  sleep 5
done
[ "$OK" = "1" ] || falha "o ArgoCD não sincronizou o corte em 5 min (replicas=$rep hostPort=${hp:-<vazio>})"
echo "  deployment no cluster: replicas=1 hostPort=5000 (ArgoCD chegou primeiro)"

PV=$($K get pvc registry-data -n "$NS" -o jsonpath='{.spec.volumeName}' 2>/dev/null)
CAMINHO=$($K get pv "$PV" -o jsonpath='{.spec.local.path}' 2>/dev/null)
echo "  dados no PVC: $(du -sh "$CAMINHO" 2>/dev/null | cut -f1) em $CAMINHO"

echo
echo "=== 1. parando o container Docker (libera a 5000) ==="
echo "  antes: $(sudo docker inspect "$DEP" --format '{{.State.Status}}' 2>/dev/null || echo '?')"
sudo docker stop "$DEP" >/dev/null || falha "docker stop falhou"
for _ in $(seq 1 30); do
  sudo ss -lntp 2>/dev/null | grep -q ':5000 ' || break
  sleep 1
done
sudo ss -lntp 2>/dev/null | grep -q ':5000 ' && falha "a 5000 continua ocupada depois de parar o container"
echo "  porta 5000 livre"

echo
echo "=== 2. apagando o pod em backoff (zera o backoff do kubelet) ==="
$K delete pod -n "$NS" -l app.kubernetes.io/name=registry --ignore-not-found --wait=true >/dev/null 2>&1

echo
echo "=== 3. esperando Ready ==="
$K rollout status "deploy/$DEP" -n "$NS" --timeout=180s || {
  $K get pods -n "$NS" -l app.kubernetes.io/name=registry -o wide | sed 's/^/    /'
  falha "o pod não ficou Ready"
}
$K get pods -n "$NS" -l app.kubernetes.io/name=registry -o wide | sed 's/^/  /'

echo
echo "=== 4. a porta 5000 é do pod? ==="
sudo ss -lntp 2>/dev/null | grep ':5000 ' | sed 's/^/  /' || echo "  NINGUÉM escutando na 5000"

echo
echo "=== 5. prova: pull real pelo NOME de produção ==="
CRED=$(python3 - /root/.docker/config.json <<'PY'
import json,sys,base64
d=json.load(open(sys.argv[1]))
for k,v in (d.get("auths") or {}).items():
    if "registry.giomartins.dev" in k and v.get("auth"):
        u,p=base64.b64decode(v["auth"]).decode().split(":",1); print(u+"\t"+p); break
PY
)
USU=$(echo "$CRED" | cut -f1); PWD_=$(echo "$CRED" | cut -f2)
[ -n "$USU" ] || falha "credencial não encontrada no docker config"

# Remove a referência antes, para o `ctr pull` NÃO sair do cache do containerd.
# Sem isto o teste passaria com o registry fora do ar ("pull completou" pode
# significar "nada foi baixado").
sudo k3s ctr -n k8s.io images rm registry.giomartins.dev:5000/vault-cli:latest >/dev/null 2>&1
timeout 150 sudo k3s ctr -n k8s.io images pull --plain-http --user "$USU:$PWD_" \
  registry.giomartins.dev:5000/vault-cli:latest 2>&1 | tail -3 | sed 's/^/  /'
sudo k3s ctr -n k8s.io images ls -q 2>/dev/null | grep -q 'registry.giomartins.dev:5000/vault-cli' \
  || falha "o pull pelo nome de produção não resultou em imagem"
echo "  OK: imagem baixada pelo nome de produção"

echo
echo "=== 6. os 39 repositórios respondem pelo nome de produção? ==="
cat=$(curl -s -u "$USU:$PWD_" --max-time 15 http://registry.giomartins.dev:5000/v2/_catalog 2>/dev/null)
n=$(echo "$cat" | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("repositories",[])))' 2>/dev/null || echo 0)
echo "  repositórios: $n"
[ "$n" = "39" ] || falha "catálogo com $n repositórios, esperado 39"

# A referência temporária do teste não deve ficar no containerd.
sudo k3s ctr -n k8s.io images rm registry.giomartins.dev:5000/vault-cli:latest >/dev/null 2>&1

echo
echo "=== 7. um pull de uma imagem que o cluster USA, pelo nome de produção ==="
# vault-cli não é usada por nenhum pod. Esta sim: prova que o caminho real
# (containerd -> registry -> PVC) continua servindo o que o cluster consome.
sudo k3s ctr -n k8s.io images rm registry.giomartins.dev:5000/excalidraw:v0.18.1 >/dev/null 2>&1
timeout 150 sudo k3s ctr -n k8s.io images pull --plain-http --user "$USU:$PWD_" \
  registry.giomartins.dev:5000/excalidraw:v0.18.1 2>&1 | tail -2 | sed 's/^/  /'
sudo k3s ctr -n k8s.io images ls -q 2>/dev/null | grep -q 'registry.giomartins.dev:5000/excalidraw:v0.18.1' \
  || falha "pull de excalidraw:v0.18.1 falhou"
echo "  OK: excalidraw:v0.18.1 baixada pelo nome de produção"

echo
echo "### CORTE CONCLUÍDO"
echo "rollback: sudo docker start registry && $K delete pod -n support -l app.kubernetes.io/name=registry"
