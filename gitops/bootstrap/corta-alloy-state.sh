#!/bin/bash
# corta-alloy-state.sh — troca o `emptyDir` das posicoes do Alloy por um PVC,
# SEM perder as posicoes que ja estao no pod em execucao.
#
# ## A ordem e o problema: por que nao e' "commit, push, deixa o ArgoCD aplicar"
#
# A mudanca esta no git (PVC `alloy-state` + `strategy: Recreate` + o
# `volumeMount` apontando para o PVC). Se eu empurrar o commit primeiro, o
# ArgoCD reconcilia em segundos, recria o pod com o PVC **vazio**, e o Alloy rele
# o log Docker inteiro -- que tem linhas de 19/10 -- e o Loki rejeita com
# `entry too far behind`. Seria repetir o bug uma ultima vez, no commit que
# deveria conserta-lo.
#
# Entao a ordem e':
#
#   1. salvar as posicoes do pod atual (elas estao em emptyDir, somem com o pod);
#   2. criar o PVC **fora do ArgoCD** (o mesmo nome que o git declara -- quando o
#      ArgoCD for aplicar, ele adota o PVC existente em vez de criar outro);
#   3. semear as posicoes no PVC, por um pod temporario;
#   4. SO ENTAO o `git push`. O ArgoCD muda o Deployment, o pod nasce com
#      `Recreate` e monta o PVC ja semeado.
#
# Entre (2) e (4) o pod em execucao continua no `emptyDir` e nada muda para ele.
#
# ## O que este script NAO faz
#
# Nao aplica o Deployment. Isso e' do ArgoCD, no push. Aplicar aqui criaria a
# divergencia git/cluster que o `selfHeal` desfaz -- e, no meio de um rollout,
# desfazer e' pior que nao fazer.
set -uo pipefail
K="sudo k3s kubectl"
NS=observability
TMP=alloy-state-seed
# Mesma imagem (e digest) do alloy: ja esta no containerd, entao o pod de
# semeadura nao depende do registry estar de pe nem de pull.
IMG="grafana/alloy@sha256:b8ec653c44235fbe910879145dac3597d66b0aaecf60bcbbe82580767771a839"

echo "UTC: $(date -u)"
A=$($K get pods -n $NS -l app.kubernetes.io/name=alloy-logs -o jsonpath='{.items[0].metadata.name}')
echo "pod atual: $A"

echo
echo "=== 0. baseline: enviadas x descartadas ==="
$K get --raw "/api/v1/namespaces/$NS/pods/$A:12345/proxy/metrics" > /tmp/am-antes.txt 2>/dev/null
SENT=$(grep '^loki_write_sent_entries_total' /tmp/am-antes.txt | awk '{print $NF}')
DROP=$(grep 'loki_write_dropped_entries_total.*ingester_error' /tmp/am-antes.txt | awk '{print $NF}')
echo "  enviadas=${SENT:-?}  descartadas=${DROP:-?}"

echo
echo "=== 1. salvando as posicoes do pod atual ==="
$K exec -n $NS "$A" -- tar -cf - -C /var/lib/alloy/data . 2>/dev/null | gzip > /tmp/state.tgz
TAM=$(stat -c %s /tmp/state.tgz 2>/dev/null || stat -f %z /tmp/state.tgz)
echo "  arquivo: ${TAM} bytes"
tar -tzf /tmp/state.tgz >/dev/null 2>&1 || { echo "  ABORTADO: tar corrompido"; exit 1; }
echo "  integro: sim, $(tar -tzf /tmp/state.tgz | wc -l | tr -d ' ') entradas"
for f in loki.source.docker.containers loki.source.kubernetes.pods; do
  echo "    $f/positions.yml: $(tar -xzOf /tmp/state.tgz "./$f/positions.yml" 2>/dev/null | wc -l | tr -d ' ') linhas"
done

echo
echo "=== 2. criando o PVC fora do ArgoCD (o git declara o mesmo nome) ==="
if $K get pvc alloy-state -n $NS >/dev/null 2>&1; then
  echo "  ja existe: $($K get pvc alloy-state -n $NS -o jsonpath='{.status.phase}') -- reutilizando"
else
  # O PVC vem de um arquivo renderizado NA MAQUINA DE DESENVOLVIMENTO e copiado
  # para ca. Nao da para chamar `kubectl kustomize` aqui: este script roda no
  # HOST, que nao tem clone do repositorio (ver a nota em sync-app-secrets.sh).
  # Renderizar de novo aqui exigiria um clone, que ficaria desatualizado -- e o
  # PVC criado a partir de um clone velho nao e' o PVC que o git declara.
  SRC=${1:-/tmp/alloy-state.yaml}
  if [ ! -s "$SRC" ]; then
    echo "  ABORTADO: $SRC nao existe ou esta vazio."
    echo "  Renderize na maquina de dev: kubectl kustomize | extraia o PVC, e passe o caminho como \$1."
    exit 1
  fi
  echo "  fonte: $SRC"
  $K apply -f "$SRC" 2>&1 | sed 's/^/  /'
fi

echo
echo "=== 3. pod temporario montando o PVC (e' o que faz o PVC bindar) ==="
# ## Por que o pod vem ANTES do `Bound`
#
# O StorageClass `local-path` deste cluster e' `WaitForFirstConsumer`: o PVC fica
# `Pending` para sempre ate' um pod monta-lo, e so entao o provisioner cria o PV.
# Esperar `Bound` antes de criar o pod trava o script num laco que nunca termina
# (aconteceu: 40 tentativas de 1s, PVC `Pending`). A ordem e' pod -> Ready ->
# entao conferir `Bound`.
$K delete pod $TMP -n $NS --ignore-not-found >/dev/null 2>&1
cat <<EOF | $K apply -f - 2>&1 | sed 's/^/  /'
apiVersion: v1
kind: Pod
metadata:
  name: $TMP
  namespace: $NS
spec:
  restartPolicy: Never
  containers:
    - name: seed
      image: $IMG
      command: ["sleep","600"]
      volumeMounts:
        - name: state
          mountPath: /state
  volumes:
    - name: state
      persistentVolumeClaim:
        claimName: alloy-state
EOF
$K wait --for=condition=Ready pod/$TMP -n $NS --timeout=120s 2>&1 | sed 's/^/  /'

echo
echo "=== 3b. agora o PVC deve estar Bound ==="
ph=""
for i in $(seq 1 30); do
  ph=$($K get pvc alloy-state -n $NS -o jsonpath='{.status.phase}' 2>/dev/null)
  [ "$ph" = "Bound" ] && { echo "  Bound"; break; }
  sleep 1
done
[ "$ph" = "Bound" ] || { echo "  ABORTADO: PVC nao ficou Bound (fase=$ph)"; $K delete pod $TMP -n $NS --ignore-not-found >/dev/null 2>&1; exit 1; }
PV=$($K get pvc alloy-state -n $NS -o jsonpath='{.spec.volumeName}')
# O `local-path` cria com Delete: perder o PV por um `prune` errado apagaria as
# posicoes e reintroduziria o bug. Retain e' o padrao deste repo para dado.
$K patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' >/dev/null 2>&1
echo "  PV=$PV policy=$($K get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}')"
echo "  caminho: $($K get pv "$PV" -o jsonpath='{.spec.local.path}')"

echo
echo "=== 4. semeando as posicoes ==="
$K cp /tmp/state.tgz $NS/$TMP:/tmp/state.tgz 2>&1 | sed 's/^/  /'
$K exec -n $NS "$TMP" -- sh -c 'tar -xzf /tmp/state.tgz -C /state && echo extraido && ls -l /state' 2>&1 | sed 's/^/  /'

echo
echo "=== 6. conferindo PVC == snapshot (bytes, nao so contagem) ==="
# ## Por que comparar com o SNAPSHOT e nao com o pod vivo
#
# A primeira versao comparava o PVC com `/var/lib/alloy/data/.../positions.yml`
# dentro do pod EM EXECUCAO. Esse arquivo e' reescrito a cada segundo (cada linha
# nova move o offset), entao o md5 muda entre a copia e a verificacao -- e o gate
# acusou DIVERGE num seed que estava correto. Compare com o arquivo que foi
# efetivamente copiado; o pod vivo so' serve para provar que ele anda.
mkdir -p /tmp/chk-seed
tar -xzf /tmp/state.tgz -C /tmp/chk-seed 2>/dev/null
FALHA=0
for f in loki.source.docker.containers loki.source.kubernetes.pods; do
  o=$(md5sum "/tmp/chk-seed/$f/positions.yml" 2>/dev/null | cut -d' ' -f1)
  n=$($K exec -n $NS "$TMP" -- sh -c "md5sum /state/$f/positions.yml 2>/dev/null | cut -d' ' -f1")
  if [ -n "$o" ] && [ "$o" = "$n" ]; then
    printf "  %-34s md5 %s OK\n" "$f" "${o:0:12}"
  else
    printf "  %-34s DIVERGE (snapshot=%s pvc=%s)\n" "$f" "${o:0:12}" "${n:0:12}"
    FALHA=1
  fi
done
echo "  (o pod vivo tem md5 diferente de proposito: o arquivo avanca a cada linha)"
echo "  pod vivo agora: $($K exec -n $NS "$A" -- sh -c "md5sum /var/lib/alloy/data/loki.source.docker.containers/positions.yml | cut -d' ' -f1" 2>/dev/null | cut -c1-12)"

echo
echo "=== 7. limpando o pod temporario ==="
# O PVC fica `Bound` apos a remocao do pod: o PV local ja existe e nao depende
# mais de consumidor. O pod atual continua no `emptyDir` ate' o push.
$K delete pod $TMP -n $NS --ignore-not-allowed >/dev/null 2>&1 || $K delete pod $TMP -n $NS --ignore-not-found >/dev/null 2>&1
echo "  removido: $($K get pod $TMP -n $NS 2>&1 | grep -c NotFound) (1 = sumiu)"

if [ "$FALHA" -ne 0 ]; then
  echo
  echo "### ABORTADO: o seed nao bate com a origem."
  echo "O PVC existe e esta semeado em parte; NAO faca o push. Investigue antes."
  exit 1
fi

echo
echo "### PRONTO PARA O PUSH"
echo "O PVC alloy-state esta Bound, Retain, e com as posicoes identicas as do pod."
echo "Proximo passo: git push. O ArgoCD troca o Deployment (Recreate) e o pod novo"
echo "monta este PVC. O pod em execucao NAO foi tocado por este script."
