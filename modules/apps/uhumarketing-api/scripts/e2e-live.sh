#!/usr/bin/env bash
# e2e real do uhumarketing: ativa o canal da conta e dispara um template de
# teste para um número, pela API — o mesmo caminho que a tela usa.
#
#   ./scripts/e2e-live.sh 5521981962914
#
# Credenciais: lê `.channel.local` (gitignored) ou as variáveis WABA_ID,
# PHONE_ID e WA_TOKEN. NUNCA imprime o token.
#
# Sessão: usa CHANNEL_EMAIL/CHANNEL_PASSWORD do ambiente, ou as flags
# --email/--password. A conta precisa já existir (o cadastro é pela tela).
#
# Etapas:
#   1. confere que o processo está em live
#   2. ativa o canal (a API chama a Graph e só grava se a Meta aceitar)
#   3. cria e submete o template
#   4. espera a aprovação da Meta (consulta ativa, sem depender de webhook)
#   5. cadastra o destino com opt-in e cria a campanha
#   6. envia o teste e mostra o status real do envio
#
# Template em análise é o único passo que depende da Meta e pode demorar. O
# script espera até WAIT_MINUTES (default 20) e sai com instrução se não voltar.

set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:8195}"
WAIT_MINUTES="${WAIT_MINUTES:-20}"
DEST="${1:-}"
[[ -n "$DEST" ]] || { echo "uso: $0 <destino com DDI, ex.: 5521981962914>"; exit 1; }
DEST="${DEST//[^0-9]/}"

# --- credenciais do canal ---------------------------------------------------
if [[ -f .channel.local ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    key="${key%% *}"
    [[ -n "${!key:-}" ]] || export "$key=$value"
  done < .channel.local
fi

for k in WABA_ID PHONE_ID WA_TOKEN; do
  [[ -n "${!k:-}" ]] || { echo "falta $k (preencha .channel.local; não cole no chat)"; exit 1; }
done

EMAIL="${CHANNEL_EMAIL:-}"
PASSWORD="${CHANNEL_PASSWORD:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --password) PASSWORD="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$EMAIL" && -n "$PASSWORD" ]] || {
  echo "informe --email e --password (ou CHANNEL_EMAIL/CHANNEL_PASSWORD)"; exit 1; }

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }

api() {
  local method="$1" path="$2" body="${3:-}"
  local tmp; tmp="$(mktemp)"
  local args=(-sS -o "$tmp" -w '%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  [[ -n "${TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$tmp")"; rm -f "$tmp"
}

fail() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*"
  printf '  status: %s\n  corpo: %s\n' "${STATUS:-?}" "${BODY:-}"
  exit 1
}
expect() { [[ "$STATUS" == "$1" ]] || fail "esperava HTTP $1${2:+ em $2}"; }

step "1/6  O processo está em live?"
api GET /healthz
expect 200
[[ "$(jq -r .live <<<"$BODY")" == "true" ]] || fail "a API está em dry-run; suba com META_MODE=live"
ok "live=true · canais=$(jq -r .channels <<<"$BODY") · webhook=$(jq -r .webhook <<<"$BODY")"

step "2/6  Sessão e canal da conta"
api POST /api/v1/auth/login "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')"
expect 200
TOKEN="$(jq -r .token <<<"$BODY")"
ok "conta $(jq -r .workspaceId <<<"$BODY")"

# dry-run aqui gravaria um canal simulado; o e2e é real, então exige live.
api PUT /api/v1/channel "$(jq -nc --arg w "$WABA_ID" --arg p "$PHONE_ID" --arg t "$WA_TOKEN" \
  '{mode:"live",wabaId:$w,phoneId:$p,token:$t}')"
if [[ "$STATUS" != "200" ]]; then
  # O erro da Graph já vem traduzido (token, banimento, parâmetro). Nada de
  # token no corpo: a API nunca devolve credencial.
  fail "a Meta recusou a ativação"
fi
ok "canal ativo: $(jq -r '.displayPhone // "?"' <<<"$BODY") · $(jq -r '.verifiedName // "sem nome"' <<<"$BODY")"

step "3/6  Template"
NAME="e2e_cupom_$(date +%H%M)"
api POST /api/v1/templates "$(jq -nc --arg n "$NAME" \
  '{name:$n,displayName:"E2E cupom",category:"marketing",language:"pt_BR",
    header:{kind:"none"},body:"Oi, {{1}}! Este é um teste de ponta a ponta do uhumarketing.",
    buttons:[],variables:[{index:"1",label:"nome",example:"Marina"}]}')"
expect 201
TPL="$(jq -r .id <<<"$BODY")"
ok "template $NAME submetido (status local: $(jq -r .status <<<"$BODY"))"

step "4/6  Aprovação da Meta (até ${WAIT_MINUTES}min)"
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
while :; do
  api POST "/api/v1/templates/$TPL/sync"
  expect 200
  STATUS_TPL="$(jq -r .status <<<"$BODY")"
  case "$STATUS_TPL" in
    approved) ok "template aprovado"; break ;;
    rejected) fail "a Meta rejeitou o template: $(jq -r .rejectionReason // "sem motivo" <<<"$BODY")" ;;
  esac
  if (( $(date +%s) > deadline )); then
    say "  · ainda em análise depois de ${WAIT_MINUTES}min."
    say "    O template $NAME já foi submetido; ele aparece em Templates Meta com o"
    say "    status atualizado. Rode de novo quando estiver aprovado — o script cria"
    say "    um template novo (a Meta aceita vários) e segue do zero."
    exit 2
  fi
  printf '  · %s; aguardando 30s\n' "$STATUS_TPL"
  sleep 30
done

step "5/6  Destino com opt-in e campanha"
api POST /api/v1/contacts "$(jq -nc --arg p "$DEST" \
  '{name:"Destino E2E",phone:$p,optIn:true,optInSource:"e2e",tags:["e2e"]}')"
expect 201
ok "contato com opt-in: $DEST"

api POST /api/v1/segments "$(jq -nc '{name:"E2E audiência",description:"e2e",kind:"static",rules:[],source:"e2e"}')"
expect 201
SEG="$(jq -r .id <<<"$BODY")"

api POST /api/v1/campaigns "$(jq -nc --arg t "$TPL" --arg s "$SEG" \
  '{name:"E2E campanha",objective:"conversao",status:"scheduled",channel:"whatsapp",
    templateId:$t,segmentIds:[$s],
    schedule:{windowStart:0,windowEnd:23,days:[0,1,2,3,4,5,6],throttlePerMinute:60,
              timezone:"America/Sao_Paulo"},
    offer:{enabled:false},requiresApproval:false,notes:"e2e"}')"
expect 201
CAMP="$(jq -r .id <<<"$BODY")"
ok "campanha $CAMP"

step "6/6  Envio de teste"
api POST "/api/v1/campaigns/$CAMP/test"
expect 201
ok "$(jq -r .queued <<<"$BODY") envio(s) na fila"

for _ in $(seq 1 30); do
  api GET "/api/v1/sends?campaignId=$CAMP"
  expect 200
  S_STATUS="$(jq -r '.[0].status // ""' <<<"$BODY")"
  case "$S_STATUS" in
    sent|delivered|read) break ;;
    failed) fail "a Meta recusou o envio: $(jq -r '.[0].error // "sem motivo"' <<<"$BODY")" ;;
  esac
  sleep 2
done

case "$S_STATUS" in
  sent|delivered|read)
    say ""
    say "E2E passou: a mensagem saiu para $DEST com status $S_STATUS."
    say "Wamid: $(jq -r '.[0].id // "?"' <<<"$BODY")"
    say "Confira no aparelho. 'sent' sem webhook público é o esperado:"
    say "entregue/lido só voltam com o callback configurado na Meta."
    ;;
  *)
    fail "o envio não saiu da fila (status=$S_STATUS)"
    ;;
esac
