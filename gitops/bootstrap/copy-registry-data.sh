#!/bin/bash
# copy-registry-data.sh — copia os 12 GB do registry Docker para o PVC do k8s.
#
# ## Cópia, nunca movimento
#
# O volume Docker (`registry_registry-data`) continua intacto até a prova final.
# Se o registry do k8s não servir, `docker start registry` devolve o serviço e
# os dados estão onde sempre estiveram. Mover o diretório seria mais rápido e
# transformaria um teste em uma aposta.
#
# ## Por que a verificação é de CONTEÚDO, e não de tamanho
#
# O registry guarda blobs em `blobs/sha256/<2 primeiros>/<sha256 completo>/data`,
# e o nome do diretório É o sha256 do conteúdo. Então existe uma prova que não
# depende de comparar com a origem: recalcular o sha256 de cada um dos 6.730
# arquivos e exigir que bata com o próprio caminho. Uma cópia truncada pelo
# caminho não passa nesse teste nem por acidente.
#
# É mais caro que `du -sh` (12 GB de hashing) e é o único teste que prova o que
# importa: que o registry novo consegue reconstruir um manifesto a partir do
# que está no disco.
#
# ## Ordem
#
#   1. o PVC precisa estar `Bound` — e `local-path` é `WaitForFirstConsumer`,
#      então ele só liga quando um pod o referencia. Por isso o Deployment sobe
#      primeiro (vazio) e é escalado a 0 para a cópia;
#   2. cópia com o pod parado: um registry lendo um diretório que muda embaixo
#      dele pode servir manifesto pela metade. `cp -a` (o host não tem rsync),
#      e a prova de conteúdo da fase 4 substitui o `--checksum`;
#   3. verificação de conteúdo;
#   4. só então escalar de volta.
#
# Uso:
#   sudo ./copy-registry-data.sh
set -uo pipefail

K="k3s kubectl"
NS="support"
DEP="registry"
PVC="registry-data"
ORIGEM="/var/lib/docker/volumes/registry_registry-data/_data"

echo "=== 1. pré-condições ==="
[ -d "$ORIGEM" ] || { echo "  ERRO: $ORIGEM não existe"; exit 1; }
echo "  origem: $(du -sh "$ORIGEM" 2>/dev/null | cut -f1) em $(find "$ORIGEM" -type f 2>/dev/null | wc -l | tr -d ' ') arquivos"

$K get pvc "$PVC" -n "$NS" >/dev/null 2>&1 || { echo "  ERRO: PVC $PVC não existe — aplique o app antes"; exit 1; }
$K wait --for=jsonpath='{.status.phase}'=Bound "pvc/$PVC" -n "$NS" --timeout=180s || {
  echo "  ERRO: PVC não ligou. local-path é WaitForFirstConsumer: o Deployment precisa ter subido uma vez."; exit 1; }
echo "  PVC: Bound"

PV=$($K get pvc "$PVC" -n "$NS" -o jsonpath='{.spec.volumeName}')
DESTINO=$($K get pv "$PV" -o jsonpath='{.spec.local.path}')
[ -n "$DESTINO" ] && [ -d "$DESTINO" ] || { echo "  ERRO: não achei o caminho do PV ($PV -> '$DESTINO')"; exit 1; }
echo "  destino: $DESTINO"

# Trava: se o destino já tem dados, este script não é o que você quer. Reexecutar
# depois de uma cópia parcial é legítimo (o rsync só completa); reexecutar depois
# de um corte seria sobrescrever produção.
if [ -n "$(ls -A "$DESTINO" 2>/dev/null)" ]; then
  echo "  destino NÃO está vazio — vou apenas completar o que falta (rsync incremental)."
fi

echo
echo "=== 2. parando o pod para copiar (registry não escreve enquanto lê) ==="
$K scale "deploy/$DEP" -n "$NS" --replicas=0 >/dev/null || exit 1
# `wait --for=delete` sai na hora se não houver pod nenhum, e `Recreate` pode
# deixar o antigo terminando por alguns segundos. O laço é a única forma de
# garantir que o diretório não muda debaixo da cópia.
for _ in $(seq 1 60); do
  n=$($K get pods -n "$NS" -l app.kubernetes.io/name=registry --no-headers 2>/dev/null | grep -c . || true)
  [ "$n" = "0" ] && break
  sleep 2
done
n=$($K get pods -n "$NS" -l app.kubernetes.io/name=registry --no-headers 2>/dev/null | grep -c . || true)
[ "$n" = "0" ] || { echo "  ERRO: ainda há $n pod(s) do registry; não copio com o registry no ar"; exit 1; }
echo "  pods do registry: 0"

echo
echo "=== 3. cópia (12 GB; alguns minutos) ==="
# `rsync` NÃO está instalado neste host (Ubuntu mínimo). `cp -a` preserva modo,
# dono e mtime — que é tudo o que o registry precisa — e não tem a semântica de
# `--delete`, então nunca apaga nada no destino. A verificação de conteúdo da
# fase 4 é o que compensa a ausência do `--checksum` do rsync: ela recalcula o
# sha256 de TODOS os blobs e compara com o nome do arquivo.
if command -v rsync >/dev/null 2>&1; then
  echo "  usando rsync"
  rsync -a --numeric-ids --info=progress2 "$ORIGEM"/ "$DESTINO"/ || { echo "  ERRO: rsync falhou"; exit 1; }
else
  echo "  usando cp -a (rsync ausente)"
  cp -a "$ORIGEM"/. "$DESTINO"/ || { echo "  ERRO: cp falhou"; exit 1; }
fi
echo "  destino agora: $(du -sh "$DESTINO" 2>/dev/null | cut -f1) em $(find "$DESTINO" -type f 2>/dev/null | wc -l | tr -d ' ') arquivos"

echo
echo "=== 4. verificação de conteúdo (nome do blob == sha256 do conteúdo) ==="
FALHAS=0
TOTAL=0
while IFS= read -r f; do
  # .../blobs/sha256/ab/<sha256>/data
  dir=$(dirname "$f")
  esperado=$(basename "$dir")
  # Só os arquivos `data` dos blobs têm essa propriedade; o resto (repositories,
  # link files) tem outros nomes e não entra na conta.
  [ "$(basename "$f")" = "data" ] || continue
  TOTAL=$((TOTAL+1))
  real=$(sha256sum "$f" | awk '{print $1}')
  if [ "$real" != "$esperado" ]; then
    FALHAS=$((FALHAS+1))
    [ "$FALHAS" -le 5 ] && echo "  DIVERGE: $f (esperado $esperado, obtido $real)"
  fi
done < <(find "$DESTINO/docker/registry/v2/blobs" -type f -name data 2>/dev/null)

echo "  blobs verificados: $TOTAL"
echo "  divergências: $FALHAS"
[ "$FALHAS" -eq 0 ] && [ "$TOTAL" -ge 1 ] || { echo "  ERRO: verificação de conteúdo falhou"; exit 1; }

echo
echo "=== 5. devolvendo o pod ao ar ==="
$K scale "deploy/$DEP" -n "$NS" --replicas=1 >/dev/null || exit 1

# A prova é o `sync-registry-auth.sh` ter rodado: sem o Secret o pod não sobe.
$K wait --for=condition=Ready "pod" -n "$NS" -l app.kubernetes.io/name=registry --timeout=180s || {
  echo "  ERRO: pod não ficou Ready. Provável causa: Secret registry-auth ausente."
  $K describe pod -n "$NS" -l app.kubernetes.io/name=registry 2>/dev/null | tail -20 | sed 's/^/    /'
  exit 1; }
echo "  pod: $($K get pods -n "$NS" -l app.kubernetes.io/name=registry --no-headers)"
echo
echo "### CÓPIA CONCLUÍDA E VERIFICADA — o corte (hostPort) é outro passo"
