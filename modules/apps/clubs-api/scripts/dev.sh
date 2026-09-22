#!/usr/bin/env bash
# Sobe a stack local do FC Clubs Hub nos MESMOS moldes de produção.
#
# Dois modos, e a diferença é só identidade:
#
#   ./dev.sh            → MODO PROD-LIKE. Sem bypass de auth: as rotas pessoais
#                         respondem 401 para quem não tem sessão de Access, e a
#                         SPA mostra "Entrar com Google". É o mais próximo
#                         possível do que sobe.
#   ./dev.sh --dev-auth → MODO DEV. Escotilha de identidade fixa, para trabalhar
#                         na camada pessoal sem o Cloudflare Access no meio.
#
# Em ambos os modos a leitura pública funciona sem login — é o desenho.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS="$(cd "$HERE/../.." && pwd)"   # modules/apps
ROOT="$(cd "$APPS/../.." && pwd)"   # repo root

DEV_AUTH=0
[[ "${1:-}" == "--dev-auth" ]] && DEV_AUTH=1

# As portas do compose.dev.yaml: publicadas no host só para os binários nativos
# conectarem.
PG_URL="postgresql://domain:devpass@localhost:15432/domain"
REDIS_ADDR="localhost:16379"

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ─── 1. base compartilhada ─────────────────────────────────────────────────
log "subindo Postgres e Redis (compose.dev.yaml publica as portas no host)"
(cd "$APPS" && docker compose -f compose.yaml -f compose.dev.yaml up -d postgres redis >/dev/null)

for _ in $(seq 1 30); do
  docker exec apps-postgres-1 pg_isready -U domain >/dev/null 2>&1 && break
  sleep 1
done
docker exec apps-postgres-1 pg_isready -U domain >/dev/null 2>&1 || fail "Postgres não ficou pronto"

# O volume pode ter sido criado com outra senha numa sessão anterior; garantir
# que bate com o que os serviços usam evita um "password authentication failed"
# que parece problema de rede.
docker exec apps-postgres-1 psql -U domain -d domain -c "ALTER USER domain WITH PASSWORD 'devpass';" >/dev/null 2>&1 || true

# ─── 2. serviços de domínio ────────────────────────────────────────────────
log "compilando domain-api e domain-worker"
(cd "$APPS/domain-worker" && go build -o /tmp/domain-worker .)
(cd "$APPS/domain-api" && go build -o /tmp/domain-api .)

pkill -f "/tmp/domain-worker" 2>/dev/null || true
pkill -f "/tmp/domain-api" 2>/dev/null || true
sleep 1

log "iniciando domain-worker (aplica o schema) e domain-api"
(DATABASE_URL="$PG_URL" REDIS_ADDR="$REDIS_ADDR" /tmp/domain-worker > /tmp/worker.log 2>&1 &)
sleep 2
(DATABASE_URL="$PG_URL" REDIS_ADDR="$REDIS_ADDR" \
 DOMAIN_API_KEYS="devkey:dev,clubs-api-key:clubs-api,clubs-ingest-key:clubs-ingest" \
 HTTP_ADDR=":8000" /tmp/domain-api > /tmp/api.log 2>&1 &)
sleep 2

curl -sf -m 5 localhost:8000/healthz >/dev/null || fail "domain-api não respondeu (veja /tmp/api.log)"

# ─── 3. dados de exemplo, pelo caminho de escrita real ─────────────────────
count=$(docker exec apps-postgres-1 psql -U domain -d domain -tAc "SELECT count(*) FROM clubs;" 2>/dev/null || echo 0)
if [[ "$count" == "0" ]]; then
  log "base vazia: semeando via /sync (o mesmo caminho que o worker usa)"
  python3 "$APPS/clubs-api/scripts/seed.py" >/dev/null || fail "seed falhou"
else
  log "base já tem $count clubes; pulando o seed"
fi

# ─── 4. clubs-api ──────────────────────────────────────────────────────────
log "compilando clubs-api"
(cd "$APPS/clubs-api" && go build -o /tmp/clubs-api .)
pkill -f "/tmp/clubs-api" 2>/dev/null || true
sleep 1

if [[ "$DEV_AUTH" == "1" ]]; then
  log "clubs-api em MODO DEV (identidade fixa: dev@local)"
  log "  as rotas pessoais respondem 200 sem login — não use este modo para validar o auth"
  (CLUBS_DOMAIN_API_URL=http://localhost:8000 \
   CLUBS_DOMAIN_API_KEY=clubs-api-key \
   CLUBS_DEV_BYPASS_AUTH=1 CLUBS_DEV_USER_EMAIL=dev@local \
   CLUBS_FRONTEND_ORIGINS="http://localhost:5173,http://localhost:4173" \
   PORT=8017 /tmp/clubs-api > /tmp/clubs-api.log 2>&1 &)
else
  # MODO PROD-LIKE: sem bypass. Sem team domain configurado, a verificação fica
  # desligada e as rotas pessoais respondem 401 — que é exatamente o
  # comportamento de produção para um visitante anônimo. Preencha
  # CLUBS_ACCESS_TEAM_DOMAIN + CLUBS_ACCESS_AUD para exercitar a verificação real
  # de JWT localmente.
  log "clubs-api em MODO PROD-LIKE (sem bypass; rotas pessoais exigem sessão)"
  if [[ -n "${CLUBS_ACCESS_TEAM_DOMAIN:-}" ]]; then
    log "  verificação de Access LIGADA (team ${CLUBS_ACCESS_TEAM_DOMAIN})"
  else
    log "  verificação de Access desligada: as rotas pessoais respondem 401 a todos"
    log "  para ligá-la: export CLUBS_ACCESS_TEAM_DOMAIN=workwithgiomartinsdev.cloudflareaccess.com"
    log "               export CLUBS_ACCESS_AUD=<aud da app do /api>"
  fi
  (CLUBS_DOMAIN_API_URL=http://localhost:8000 \
   CLUBS_DOMAIN_API_KEY=clubs-api-key \
   CLUBS_ACCESS_TEAM_DOMAIN="${CLUBS_ACCESS_TEAM_DOMAIN:-}" \
   CLUBS_ACCESS_AUD="${CLUBS_ACCESS_AUD:-}" \
   CLUBS_ALLOWED_EMAILS="${CLUBS_ALLOWED_EMAILS:-}" \
   CLUBS_FRONTEND_ORIGINS="http://localhost:5173,http://localhost:4173" \
   PORT=8017 /tmp/clubs-api > /tmp/clubs-api.log 2>&1 &)
fi
sleep 2

# ─── 5. SPA ────────────────────────────────────────────────────────────────
if ! curl -sf -m 2 localhost:5173 >/dev/null 2>&1; then
  log "iniciando a SPA em http://localhost:5173"
  (cd "$APPS/clubs-frontend" && npx vite --port 5173 > /tmp/vite.log 2>&1 &)
  sleep 4
fi

# ─── resumo ────────────────────────────────────────────────────────────────
echo
echo "  SPA        http://localhost:5173"
echo "  clubs-api  http://localhost:8017/healthz"
echo "  domain-api http://localhost:8000/healthz"
echo
log "conferindo o modo de identidade:"
curl -s localhost:8017/healthz | python3 -m json.tool 2>/dev/null || true
echo
if [[ "$DEV_AUTH" == "1" ]]; then
  echo "  /api/me → $(curl -s -o /dev/null -w '%{http_code}' localhost:8017/api/me) (200 = identidade fixa ativa)"
else
  echo "  /api/me → $(curl -s -o /dev/null -w '%{http_code}' localhost:8017/api/me) (401 = anônimo de verdade, como em produção)"
  echo "  público → $(curl -s -o /dev/null -w '%{http_code}' 'localhost:8017/api/rankings/clubs?metrica=nivel') (200 = leitura aberta, como em produção)"
fi
echo
echo "  logs: /tmp/worker.log  /tmp/api.log  /tmp/clubs-api.log  /tmp/vite.log"
