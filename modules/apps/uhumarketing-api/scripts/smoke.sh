#!/usr/bin/env bash
# Smoke E2E do uhumarketing contra uma instância já publicada.
#
# Percorre o caminho que importa de ponta a ponta — cadastro, canal, template,
# audiência, campanha e envio de teste — e mostra onde parou. É o mesmo caminho
# que a tela faz, pelas mesmas rotas: se isto passa, o produto está de pé.
#
#   ./scripts/smoke.sh https://uhu.seudominio.com
#   BASE=http://localhost:8080 ./scripts/smoke.sh
#
# Não usa credencial da Meta: em META_MODE=dry-run o envio de teste é simulado.
# Em live, o envio só sai se a conta já tiver canal ativado (aí o smoke não
# ativa nada — ativar exige as credenciais do dono).
#
# Não imprime token nem senha.

set -euo pipefail

BASE="${1:-${BASE:-http://localhost:8080}}"
BASE="${BASE%/}"

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }

command -v jq >/dev/null || { echo "preciso de jq"; exit 1; }
command -v curl >/dev/null || { echo "preciso de curl"; exit 1; }

# E-mail único por execução: o smoke pode rodar várias vezes na mesma instância.
EMAIL="smoke+$(date +%s)@uhu.local"
PASS="smoke-$(date +%s)"
PHONE="5511${RANDOM}${RANDOM}"

# api METHOD PATH [BODY] — imprime o corpo e guarda o status em $STATUS.
api() {
  local method="$1" path="$2" body="${3:-}"
  local tmp; tmp="$(mktemp)"
  local args=(-sS -o "$tmp" -w '%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  [[ -n "${TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

fail() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*"
  printf '  status: %s\n  corpo: %s\n' "${STATUS:-?}" "${BODY:-}"
  exit 1
}

expect() { [[ "$STATUS" == "$1" ]] || fail "esperava HTTP $1${2:+ em $2}"; }

step "1/7  Saúde ($BASE)"
api GET /healthz
expect 200
[[ "$(jq -r .database <<<"$BODY")" == "ok" ]] || fail "banco não está ok"
ok "banco ok · live=$(jq -r .live <<<"$BODY") · canais=$(jq -r .channels <<<"$BODY")"

WEBHOOK="$(jq -r .webhook <<<"$BODY")"
if [[ "$WEBHOOK" == "signed" ]]; then
  ok "webhook com assinatura verificada"
elif [[ "$(jq -r .live <<<"$BODY")" == "true" ]]; then
  fail "em live o webhook precisa de META_APP_SECRET (estado: $WEBHOOK)"
else
  say "  · webhook $WEBHOOK (ok em dry-run/sem segredo)"
fi

step "2/7  SPA servida na mesma origem"
api GET /index.html
if [[ "$STATUS" == "200" ]] && grep -q '<div id="root">' <<<"$BODY"; then
  ok "index.html servido"
else
  say "  · SPA não servida nesta origem (API sozinha). No deploy ela vem do nginx."
  say "    Se o navegador abre a tela em outro domínio, rode o smoke com ele."
fi

step "3/7  Cadastro cria conta e workspace vazio"
api POST /api/v1/auth/signup \
  "$(jq -nc --arg n "Smoke" --arg e "$EMAIL" --arg p "$PASS" --arg c "Smoke Ltda" \
     '{name:$n,email:$e,password:$p,company:$c}')"
expect 201
TOKEN="$(jq -r .token <<<"$BODY")"
WS="$(jq -r .workspaceId <<<"$BODY")"
[[ -n "$TOKEN" && "$TOKEN" != null ]] || fail "cadastro não devolveu token"
ok "workspace $WS"
api GET /api/v1/bootstrap
expect 200
[[ "$(jq '.templates|length' <<<"$BODY")" == "0" ]] || fail "conta nova veio com dado"
MODE="$(jq -r .provider.mode <<<"$BODY")"
ok "conta nasce vazia · canal em modo $MODE"

step "4/7  Ativa o canal em dry-run (simulado)"
# Em live esta chamada gravaria credenciais de verdade; sem token da Meta não há
# como ativar, e é por isso que o smoke só ativa no modo simulado.
if [[ "$MODE" == "dry-run" ]]; then
  api PUT /api/v1/channel \
    "$(jq -nc --arg p "smoke-phone-$RANDOM$RANDOM" \
       '{mode:"dry-run",wabaId:"smoke-waba",phoneId:$p,token:"smoke-token"}')"
  expect 200
  ok "canal ativado (simulado)"
else
  ok "modo live: pulando ativação (exige credenciais do dono)"
fi

step "5/7  Template + audiência + contato com opt-in"
api POST /api/v1/templates \
  "$(jq -nc '{name:"smoke_cupom",displayName:"Smoke cupom",category:"marketing",
              language:"pt_BR",header:{kind:"none"},body:"Oi, {{1}}! Este é um teste.",
              buttons:[],variables:[{index:"1",label:"nome",example:"Ana"}]}')"
expect 201
TPL="$(jq -r .id <<<"$BODY")"
ok "template $TPL ($(jq -r .status <<<"$BODY"))"

api POST /api/v1/segments \
  "$(jq -nc '{name:"Smoke audiência",description:"smoke",kind:"static",rules:[],source:"smoke"}')"
expect 201
SEG="$(jq -r .id <<<"$BODY")"

api POST /api/v1/contacts \
  "$(jq -nc --arg p "$PHONE" '{name:"Contato Smoke",phone:$p,optIn:true,optInSource:"smoke",tags:[]}')"
expect 201
ok "contato com opt-in ($PHONE) e audiência $SEG"

step "6/7  Campanha + envio de teste"
api POST /api/v1/campaigns \
  "$(jq -nc --arg t "$TPL" --arg s "$SEG" \
     '{name:"Smoke campanha",objective:"conversao",status:"scheduled",channel:"whatsapp",
       templateId:$t,segmentIds:[$s],
       schedule:{windowStart:9,windowEnd:18,days:[0,1,2,3,4,5,6],throttlePerMinute:60,
                 timezone:"America/Sao_Paulo"},
       offer:{enabled:false},requiresApproval:false,notes:"smoke"}')"
expect 201
CAMP="$(jq -r .id <<<"$BODY")"

api POST "/api/v1/campaigns/$CAMP/test"
expect 201
QUEUED="$(jq -r .queued <<<"$BODY")"
[[ "$QUEUED" == "1" ]] || fail "envio de teste não entrou na fila (queued=$QUEUED)"
ok "1 envio na fila"

step "7/7  Fila processa e o envio sai"
# Em live o worker pode levar até WORKER_INTERVAL_SECONDS; em dry-run é quase
# imediato. Não existe rota de tick com ALLOW_DEV_ACTIONS=false, então espera.
for _ in $(seq 1 15); do
  api GET "/api/v1/sends?campaignId=$CAMP"
  expect 200
  STATUS_SEND="$(jq -r '.[0].status // ""' <<<"$BODY")"
  [[ "$STATUS_SEND" == "sent" || "$STATUS_SEND" == "delivered" || "$STATUS_SEND" == "read" ]] && break
  sleep 1
done
case "$STATUS_SEND" in
  sent|delivered|read) ok "envio com status $STATUS_SEND" ;;
  failed) fail "envio falhou: $(jq -r '.[0].error // "sem motivo"' <<<"$BODY")" ;;
  *) fail "envio não saiu da fila (status=$STATUS_SEND)" ;;
esac

say ""
say "Smoke passou: cadastro → canal → template → audiência → campanha → envio."
say "Conta criada: $EMAIL"
