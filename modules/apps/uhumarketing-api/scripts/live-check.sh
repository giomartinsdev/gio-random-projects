#!/usr/bin/env bash
# Confere se o ambiente está pronto para META_MODE=live antes de subir a API.
#
# Existe porque o boot em live falha (de propósito) quando falta credencial, e
# descobrir isso no primeiro disparo é pior do que descobrir aqui. Não imprime
# o token: só o tamanho e se ele foi aceito pela Graph.
#
#   ./scripts/live-check.sh
#
# Lê as variáveis do ambiente ou do arquivo .env ao lado do compose.

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

say "Variáveis"

if [[ "${META_MODE:-dry-run}" == "live" ]]; then
  good "META_MODE=live"
else
  bad "META_MODE=${META_MODE:-dry-run} — sem 'live' nada sai para a Meta"
fi

for v in META_WABA_ID META_PHONE_NUMBER_ID META_TOKEN; do
  val="${!v:-}"
  if [[ -n "$val" ]]; then
    good "$v definido (${#val} caracteres)"
  else
    bad "$v ausente"
  fi
done

if [[ -n "${META_APP_SECRET:-}" ]]; then
  good "META_APP_SECRET definido (webhook assinado)"
else
  say "  · META_APP_SECRET ausente: o webhook aceita payload sem assinatura (ok só local)"
fi

if [[ -n "${PUBLIC_BASE_URL:-}" && "${PUBLIC_BASE_URL}" != http://localhost* ]]; then
  good "PUBLIC_BASE_URL público: ${PUBLIC_BASE_URL}"
else
  say "  · PUBLIC_BASE_URL não público: sem webhook, entregue/lido não voltam sozinhos"
  say "    use o botão 'Consultar status na Meta' para o template"
fi

if [[ $fail -ne 0 ]]; then
  say ""
  say "Faltam credenciais. Passo a passo em README.md > Modo live."
  exit 1
fi

say ""
say "Graph API"

base="${META_GRAPH_URL:-https://graph.facebook.com}"
ver="${META_GRAPH_VERSION:-v21.0}"
url="$base/$ver/$META_PHONE_NUMBER_ID?fields=display_phone_number,verified_name,quality_rating"

body=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $META_TOKEN" "$url")
code=$(printf '%s' "$body" | tail -1)
payload=$(printf '%s' "$body" | sed '$d')

if [[ "$code" != "200" ]]; then
  if printf '%s' "$payload" | grep -qiE '"code":(131031|131047|368)|restricted|banned|enforcement'; then
    say "  ✗ a Meta diz que a conta do WhatsApp está RESTRITA/BANIDA"
    say ""
    say "  Nenhum envio é possível enquanto a restrição existir, mesmo com token"
    say "  válido. O caminho é abrir recurso no Meta Business Suite:"
    say "    https://business.facebook.com/latest/accountquality"
    say ""
    say "  Depois que a Meta liberar, os IDs aparecem de novo em:"
    say "    https://developers.facebook.com/apps → seu app → WhatsApp → API Setup"
  else
    bad "a Graph recusou ($code): $payload"
  fi
  exit 1
fi

say "  ✓ número: $(printf '%s' "$payload" | sed -n 's/.*"display_phone_number":"\([^"]*\)".*/\1/p')"
say "  ✓ nome:   $(printf '%s' "$payload" | sed -n 's/.*"verified_name":"\([^"]*\)".*/\1/p')"
say ""
say "Pronto. Suba a API com META_MODE=live e o 'Testar conexão' deve mostrar o número."
