#!/usr/bin/env bash
# Confere se o ambiente está pronto para META_MODE=live antes de subir a API.
#
# O serviço não tem mais WABA global: cada conta ativa o próprio WhatsApp em
# Configurações → WhatsApp, e o token dela é gravado cifrado. Este script
# confere o que é do PROCESSO (modo + chave de cifra) e, se você passar as
# credenciais de uma conta, testa essa conta contra a Graph sem gravar nada.
#
#   ./scripts/live-check.sh
#   WABA_ID=... PHONE_ID=... WA_TOKEN=... ./scripts/live-check.sh
#
# Não imprime o token: só o tamanho e se ele foi aceito pela Graph.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # Carrega o .env SEM sobrescrever o que já veio do ambiente: rodar
  # `META_MODE=live ./scripts/live-check.sh` tem que valer, mesmo com o .env
  # ainda em dry-run.
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    key="${key%% *}"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < .env
fi

fail=0
say() { printf '%s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*"; fail=1; }
good() { printf '  ✓ %s\n' "$*"; }

say "Processo"

if [[ "${META_MODE:-dry-run}" == "live" ]]; then
  good "META_MODE=live"
else
  bad "META_MODE=${META_MODE:-dry-run} — sem 'live' nada sai para a Meta"
fi

# A chave é o que impede o token de cada conta de ficar em claro no banco.
if [[ -n "${CHANNEL_SECRET:-}" && ${#CHANNEL_SECRET} -ge 16 ]]; then
  good "CHANNEL_SECRET definido (${#CHANNEL_SECRET} caracteres)"
else
  bad "CHANNEL_SECRET ausente ou curto (mínimo 16) — o boot em live recusa"
fi

if [[ -n "${META_APP_SECRET:-}" ]]; then
  good "META_APP_SECRET definido (webhook assinado)"
else
  bad "META_APP_SECRET ausente — em live o webhook recusa evento (503) até configurar"
  say "    App Settings → Basic → App Secret. Sem ele, entregue/lido não voltam."
fi

if [[ -n "${PUBLIC_BASE_URL:-}" && "${PUBLIC_BASE_URL}" != http://localhost* ]]; then
  good "PUBLIC_BASE_URL público: ${PUBLIC_BASE_URL}"
else
  bad "PUBLIC_BASE_URL ausente ou local — a Meta não alcança localhost"
  say "    use o endereço HTTPS do deploy; a tela mostra o callback a colar na Meta"
fi

say ""
say "Conta (opcional: WABA_ID, PHONE_ID e WA_TOKEN)"

waba="${WABA_ID:-}"
phone="${PHONE_ID:-}"
token="${WA_TOKEN:-}"

if [[ -z "$waba" && -z "$phone" && -z "$token" ]]; then
  say "  · credenciais de conta não informadas; a ativação é feita na tela"
  say "    Configurações → WhatsApp (a API confere com a Graph antes de gravar)"
elif [[ -z "$waba" || -z "$phone" || -z "$token" ]]; then
  bad "informe as três: WABA_ID, PHONE_ID e WA_TOKEN"
else
  good "WABA_ID definido (${#waba} caracteres)"
  good "PHONE_ID definido (${#phone} caracteres)"
  good "WA_TOKEN definido (${#token} caracteres)"

  say ""
  say "Graph API"
  base="${META_GRAPH_URL:-https://graph.facebook.com}"
  ver="${META_GRAPH_VERSION:-v21.0}"
  url="$base/$ver/$phone?fields=display_phone_number,verified_name,quality_rating"

  body=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $token" "$url")
  code=$(printf '%s' "$body" | tail -1)
  payload=$(printf '%s' "$body" | sed '$d')

  if [[ "$code" == "200" ]]; then
    number=$(printf '%s' "$payload" | sed -n 's/.*"display_phone_number":"\([^"]*\)".*/\1/p')
    name=$(printf '%s' "$payload" | sed -n 's/.*"verified_name":"\([^"]*\)".*/\1/p')
    good "número ${number:-?} (${name:-sem nome verificado}) respondeu"
  else
    bad "a Graph recusou (HTTP $code)"

    # Banimento é o bloqueio que não se resolve com token novo. A orientação
    # vale mais do que o código.
    if printf '%s' "$payload" | grep -qE '131031|131042|"code":368|131047|restricted|banned|enforcement'; then
      say "    a WABA está restrita ou banida pela Meta."
      say "    abra um recurso em https://business.facebook.com/latest/accountquality"
      say "    enquanto a restrição existir, nenhum envio é possível, mesmo com token válido"
    elif printf '%s' "$payload" | grep -q '"code":190'; then
      say "    token inválido ou expirado: gere outro em API Setup (ou um permanente com System User)"
    else
      say "    meta: $(printf '%s' "$payload" | head -c 300)"
    fi
  fi
fi

if [[ $fail -ne 0 ]]; then
  say ""
  say "Pendências acima. Passo a passo em README.md > Modo live."
  exit 1
fi

say ""
say "Tudo pronto. Suba a API com META_MODE=live e ative o WhatsApp da conta na tela."
