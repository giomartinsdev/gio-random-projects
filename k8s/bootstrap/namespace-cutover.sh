#!/bin/bash
# namespace-cutover.sh — move um serviço de namespace preservando o dado.
#
# ## O problema que este script resolve
#
# PVC é namespaced. Não existe "mover um PVC": o PVC antigo tem que ser apagado e
# um novo criado no destino. Com `reclaimPolicy=Delete` (o padrão do local-path),
# apagar o PVC apaga o diretório — 2,4 GB de Postgres viram pó.
#
# ## O mecanismo (provado em /tmp/prova3.sh antes de ser escrito aqui)
#
#   Bound --(PVC apagado + Retain)--> Released --(remover claimRef)--> Available
#         --(claimRef aponta para o PVC futuro)--> Bound (no MESMO diretório)
#
# Nenhum byte é copiado. O PV continua apontando para o mesmo `local.path`; só o
# `claimRef` muda de `giomartins/postgres-data` para `persistence/postgres-data`.
#
# ## As três armadilhas que a prova encontrou
#
# 1. **Pod existente segura o PVC.** Apagar o PVC com o pod ainda lá (mesmo
#    `Completed`) prende o PVC em `Terminating` para sempre por causa do
#    finalizer `pvc-protection`, e `kubectl delete --wait=true` bloqueia sem
#    prazo. Ordem obrigatória: workload → 0, ESPERAR o pod sumir, só então PVC.
#
# 2. **`Released` não aceita claim novo.** Setar `claimRef` num PV `Released` não
#    transiciona nada: o PVC fica `Pending` e o local-path provisiona um volume
#    NOVO e VAZIO. O pod sobe, roda, e o dado não está lá. É o pior modo de falha
#    possível — parece sucesso. É preciso passar por `Available` primeiro,
#    removendo o `claimRef`.
#
# 3. **Asserção de identidade.** Depois de criar o PVC, `volumeName` do PVC novo
#    TEM que ser igual ao PV original. Um volume novo também deixa o pod rodar;
#    só essa comparação distingue "migrou" de "perdeu o dado".
#
# ## Uso
#
#   sudo namespace-cutover.sh <serviço> <namespace-origem> <namespace-destino>
#   sudo namespace-cutover.sh postgres giomartins persistence --dry-run
set -uo pipefail || exit 1

K="kubectl"
SVC="${1:-}"
ORIGEM="${2:-}"
DESTINO="${3:-}"
DRY="${4:-}"

if [ -z "$SVC" ] || [ -z "$ORIGEM" ] || [ -z "$DESTINO" ]; then
  echo "uso: $0 <serviço> <namespace-origem> <namespace-destino> [--dry-run]"
  exit 2
fi

log()  { echo "  [$SVC] $*"; }
erro() { echo "  [$SVC] ERRO: $*" >&2; }

# ---------------------------------------------------------------------------
# 0. Pré-condições
# ---------------------------------------------------------------------------
PVC_ANTIGO="$SVC-data"

PV=$($K get pvc "$PVC_ANTIGO" -n "$ORIGEM" -o jsonpath='{.spec.volumeName}' 2>/dev/null)
if [ -z "$PV" ]; then
  erro "PVC $PVC_ANTIGO não existe em $ORIGEM — nada a preservar"
  erro "se o serviço não tem estado, use o caminho sem PVC (ver --stateless)"
  exit 1
fi

# O PV TEM que estar em Retain ANTES de qualquer coisa. Se estiver Delete e algo
# falhar no meio, o diretório some.
POLICY=$($K get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}')
if [ "$POLICY" != "Retain" ]; then
  log "PV $PV está em $POLICY — mudando para Retain ANTES de tocar no PVC"
  $K patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' >/dev/null || {
    erro "não consegui mudar o reclaimPolicy — abortando (nada foi tocado)"; exit 1; }
fi

DIR=$($K get pv "$PV" -o jsonpath='{.spec.local.path}')
log "PV=$PV"
log "diretório no disco=$DIR"

if [ ! -d "$DIR" ]; then
  erro "o diretório do PV não existe no disco — abortando"
  exit 1
fi

# Contagem de arquivos ANTES. Serve de testemunha no fim: se o destino tiver
# menos arquivos que a origem, alguma coisa se perdeu no caminho.
ANTES=$(find "$DIR" -type f 2>/dev/null | wc -l)
log "arquivos no volume antes: $ANTES"

if [ "$DRY" = "--dry-run" ]; then
  log "DRY-RUN: pararia o workload, apagaria $PVC_ANTIGO, re-bindaria para $DESTINO/$PVC_ANTIGO"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Parar o workload e ESPERAR o pod sumir
# ---------------------------------------------------------------------------
log "escalando $SVC para 0 em $ORIGEM"
$K scale deploy "$SVC" -n "$ORIGEM" --replicas=0 >/dev/null 2>&1 || {
  erro "não consegui escalar o Deployment — abortando"; exit 1; }

for i in $(seq 1 60); do
  n=$($K get pods -n "$ORIGEM" -l "app.kubernetes.io/name=$SVC" --no-headers 2>/dev/null | wc -l)
  [ "$n" -eq 0 ] && break
  sleep 2
done
if [ "$n" -ne 0 ]; then
  erro "o pod não sumiu em 120s — abortando SEM tocar no PVC"
  exit 1
fi
log "pod removido"

# ---------------------------------------------------------------------------
# 2. Apagar o PVC e esperar Released
# ---------------------------------------------------------------------------
log "apagando PVC $PVC_ANTIGO em $ORIGEM"
$K delete pvc "$PVC_ANTIGO" -n "$ORIGEM" --timeout=60s >/dev/null 2>&1 || true

for i in $(seq 1 30); do
  ph=$($K get pv "$PV" -o jsonpath='{.status.phase}')
  [ "$ph" = "Released" ] && break
  sleep 1
done
if [ "$ph" != "Released" ]; then
  erro "PV não chegou a Released (está $ph) — o dado continua em $DIR"
  exit 1
fi
log "PV Released, dado intacto ($(find "$DIR" -type f 2>/dev/null | wc -l) arquivos)"

# ---------------------------------------------------------------------------
# 3. Released -> Available (o passo que a prova 2 esqueceu)
# ---------------------------------------------------------------------------
log "removendo claimRef"
$K patch pv "$PV" --type=json -p='[{"op":"remove","path":"/spec/claimRef"}]' >/dev/null 2>&1 \
  || $K patch pv "$PV" --type=merge -p '{"spec":{"claimRef":null}}' >/dev/null 2>&1

for i in $(seq 1 30); do
  ph=$($K get pv "$PV" -o jsonpath='{.status.phase}')
  [ "$ph" = "Available" ] && break
  sleep 1
done
if [ "$ph" != "Available" ]; then
  erro "PV não chegou a Available (está $ph) — o dado continua em $DIR"
  exit 1
fi
log "PV Available"

# ---------------------------------------------------------------------------
# 4. Reservar o PV para o PVC que vai nascer
# ---------------------------------------------------------------------------
log "reservando o PV para $DESTINO/$PVC_ANTIGO"
$K patch pv "$PV" --type=merge \
  -p "{\"spec\":{\"claimRef\":{\"namespace\":\"$DESTINO\",\"name\":\"$PVC_ANTIGO\"}}}" >/dev/null

# ---------------------------------------------------------------------------
# 5. Criar o PVC no destino
# ---------------------------------------------------------------------------
# O PVC é recriado a partir do manifesto do git (o kustomization do destino), que
# é a única definição de tamanho e accessModes. Aqui só criamos o mínimo; o
# ArgoCD faz o resto no próximo sync e o selfHeal corrige divergência.
CAP=$($K get pv "$PV" -o jsonpath='{.spec.capacity.storage}')
log "criando PVC $PVC_ANTIGO em $DESTINO (capacidade $CAP)"

$K apply -f - >/dev/null <<YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $PVC_ANTIGO
  namespace: $DESTINO
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: local-path
  resources:
    requests:
      storage: $CAP
YAML

for i in $(seq 1 30); do
  ph=$($K get pvc "$PVC_ANTIGO" -n "$DESTINO" -o jsonpath='{.status.phase}' 2>/dev/null)
  [ "$ph" = "Bound" ] && break
  sleep 1
done

NOVO=$($K get pvc "$PVC_ANTIGO" -n "$DESTINO" -o jsonpath='{.spec.volumeName}' 2>/dev/null)
log "PVC no destino: phase=$ph volumeName=$NOVO"

# ---------------------------------------------------------------------------
# 6. A asserção que distingue migração de perda de dado
# ---------------------------------------------------------------------------
if [ "$NOVO" != "$PV" ]; then
  erro "ligou em '$NOVO' em vez de '$PV' — é um volume NOVO e VAZIO"
  erro "o dado original continua em $DIR (PVC antigo apagado, PV $PV livre)"
  erro "para recuperar: kubectl patch pv $PV ... e refazer o bind"
  exit 1
fi
log "OK: mesmo PV, mesmo diretório"

DEPOIS=$(find "$DIR" -type f 2>/dev/null | wc -l)
log "arquivos no volume depois: $DEPOIS (antes: $ANTES)"
if [ "$DEPOIS" -lt "$ANTES" ]; then
  erro "o volume tem MENOS arquivos que antes — investigar antes de subir o pod"
  exit 1
fi

log "pronto para o ArgoCD aplicar o Deployment em $DESTINO"
