#!/bin/bash
# corta-registry.sh — troca o registry Docker pelo registry do k8s na porta 5000.
#
# ## A ordem não é negociável
#
#   1. parar o container Docker (libera a 5000);
#   2. aplicar o manifesto (Deployment com `hostPort: 5000`);
#   3. APAGAR qualquer pod em backoff e esperar um novo ficar Ready;
#   4. provar com um pull real (`ctr`), que é o cliente de todo pod deste cluster.
#
# Invertido (aplicar primeiro, com o container no ar) o pod entra em
# `CrashLoopBackOff` ("bind: address already in use"), e o kubelet aplica backoff
# exponencial: mesmo depois de a porta ser liberada, o k8s pode levar até 5 min
# para tentar de novo. Por isso o passo 3 apaga o pod — é o que transforma uma
# espera em um instante.
#
# ## O rollback é uma linha, e é verdade
#
# `sudo docker start registry` + apagar o pod (para liberar a 5000). O container
# e os dados dele nunca são tocados por este script.
#
# ## Por que recebe um arquivo de manifesto
#
# O host NÃO tem clone do repositório — este script é instalado avulso em
# `/usr/local/sbin`, como o `sync-app-secrets.sh`. Então `apply -k` não funciona
# aqui: o manifesto chega já renderizado por `kubectl kustomize` na máquina de
# desenvolvimento, e o que se aplica é exatamente o que o ArgoCD aplicaria.
#
# Uso:
#   sudo ./corta-registry.sh /tmp/registry-final.yaml
set -uo pipefail
K="k3s kubectl"
MANIFESTO="${1:-}"
[ -r "$MANIFESTO" ] || { echo "ERRO: uso: $0 <manifesto-renderizado.yaml>"; exit 1; }

echo "=== 0. pré-condições ==="
PV=$($K get pvc registry-data -n support -o jsonpath='{.spec.volumeName}' 2>/dev/null)
CAMINHO=$($K get pv "$PV" -o jsonpath='{.spec.local.path}' 2>/dev/null)
TAM=$(du -sh "$CAMINHO" 2>/dev/null | cut -f1)
echo "  dados no PVC: ${TAM:-<desconhecido>} em $CAMINHO"
[ -n "$TAM" ] || { echo "  ERRO: não consegui medir o PVC"; exit 1; }

echo "  container Docker: $(sudo docker inspect registry --format '{{.State.Status}}' 2>/dev/null || echo '<ausente>')"
echo "  porta 5000: $(sudo ss -lntp 2>/dev/null | grep -c ':5000 ' || true) listener(s)"
echo "  manifesto: $MANIFESTO"

echo
echo "=== 1. parando o container Docker (libera a 5000) ==="
sudo docker stop registry >/dev/null || { echo "  ERRO: docker stop falhou"; exit 1; }
for _ in $(seq 1 30); do
  sudo ss -lntp 2>/dev/null | grep -q ':5000 ' || break
  sleep 1
done
if sudo ss -lntp 2>/dev/null | grep -q ':5000 '; then
  echo "  ERRO: a 5000 continua ocupada depois de parar o container"
  sudo ss -lntp 2>/dev/null | grep ':5000 ' | sed 's/^/    /'
  sudo docker start registry >/dev/null
  exit 1
fi
echo "  porta 5000 livre"

echo
echo "=== 2. aplicando o manifesto ==="
$K apply -f "$MANIFESTO" || {
  echo "  ERRO: apply falhou -- religando o container"
  sudo docker start registry >/dev/null
  exit 1; }

echo
echo "=== 3. apagando pod em backoff e esperando Ready ==="
# Se o ArgoCD reconciliou no intervalo entre o push e o `docker stop`, já existe
# um pod em CrashLoopBackOff. Apagá-lo zera o backoff; sem isto, o pod saudável
# esperaria minutos para ser tentado de novo.
$K delete pod -n support -l app.kubernetes.io/name=registry --ignore-not-found --wait=true >/dev/null 2>&1
$K rollout status deploy/registry -n support --timeout=180s || {
  echo "  ERRO: pod não ficou Ready. Diagnóstico:"
  $K get pods -n support -l app.kubernetes.io/name=registry -o wide | sed 's/^/    /'
  $K describe pod -n support -l app.kubernetes.io/name=registry 2>/dev/null | tail -18 | sed 's/^/    /'
  echo "  ROLLBACK: sudo docker start registry  (e apague o pod para liberar a 5000)"
  exit 1; }
$K get pods -n support -l app.kubernetes.io/name=registry -o wide | sed 's/^/  /'

echo
echo "=== 4. a porta 5000 é do pod? ==="
sudo ss -lntp 2>/dev/null | grep ':5000 ' | sed 's/^/  /'

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
[ -n "$USU" ] || { echo "  ERRO: credencial não encontrada no docker config"; exit 1; }

# Remove a referência antes, para o `ctr pull` NÃO sair do cache do containerd.
# Sem isto o teste passaria com o registry fora do ar ("pull completou" pode
# significar "nada foi baixado").
sudo k3s ctr -n k8s.io images rm registry.giomartins.dev:5000/vault-cli:latest >/dev/null 2>&1

timeout 150 sudo k3s ctr -n k8s.io images pull --plain-http --user "$USU:$PWD_" \
  registry.giomartins.dev:5000/vault-cli:latest 2>&1 | tail -3 | sed 's/^/  /'

if sudo k3s ctr -n k8s.io images ls -q 2>/dev/null | grep -q 'registry.giomartins.dev:5000/vault-cli'; then
  echo "  OK: imagem baixada pelo nome de produção"
else
  echo "  ERRO: o pull pelo nome de produção não resultou em imagem"
  echo "  ROLLBACK: sudo docker start registry  (e apague o pod)"
  exit 1
fi

echo
echo "=== 6. os 39 repositórios respondem pelo nome de produção? ==="
cat=$(curl -s -u "$USU:$PWD_" --max-time 15 http://registry.giomartins.dev:5000/v2/_catalog 2>/dev/null)
echo "  repositórios: $(echo "$cat" | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("repositories",[])))' 2>/dev/null || echo '?')"

# A referência temporária do teste não deve ficar no containerd com o nome de
# produção apontando para uma imagem que talvez não seja a que está no ar.
sudo k3s ctr -n k8s.io images rm registry.giomartins.dev:5000/vault-cli:latest >/dev/null 2>&1

echo
echo "### CORTE CONCLUÍDO"
echo "rollback: sudo docker start registry && $K delete pod -n support -l app.kubernetes.io/name=registry"
