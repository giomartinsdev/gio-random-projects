# asset-manager-api

BFF for the **Asset Manager** module of the personal finance feature
(`specs/002-gestao-financeira-modular`). It has no database of its
own: every position (`Ativo`) and movement (`AtivoMovimento`) is
persisted through the shared `domain-api`. The only state this process
keeps for itself is an in-memory, non-durable cache of quotes fetched
from brapi.dev (`internal/quotes`).

## Routes

| Route | Auth | Behavior |
|---|---|---|
| `GET /api/health` | none | liveness probe |
| `GET /api/me` | Access | identity probe |
| `GET /api/sso?return=` | none (login hop) | same pattern as every other module |
| `GET /api/ativos?conta=` | Access | positions of the logged-in person, with computed rentabilidade |
| `POST /api/ativos` | Access | `{contaId, ticker, quantidade, precoUnitario, data}` — first purchase |
| `POST /api/ativos/{id}/movimentos` | Access | `{tipo: compra\|venda\|provento, quantidade?, precoUnitario?, valorProvento?, data}` |
| `GET /api/ativos/{id}/movimentos` | Access | movement history of one ativo |
| `GET /api/cotacoes?tickers=A,B,C` | Access | current quotes, cache-first |

Error bodies follow the platform convention:
`{"erro":{"codigo","mensagem"[,"detalhes"]}}`.

## domain-api integration

- Create ativo → `POST /sync` `{"action":"ativo.create","payload":{...}}`
- Register movement → `POST /sync` `{"action":"ativo.registerMovement","payload":{...}}`
- Read positions → `GET /ativos?usuario=<email>&conta=`
- Read history → `GET /ativos/{id}/movimentos`
- Persist last-known quote (fire-and-forget, background) →
  `POST /ativos/{id}/cotacao` `{cotacao, obtida_em}`, expects `202`

> Note: the reference contract doc at
> `specs/002-gestao-financeira-modular/contracts/domain-api-extensions.md`
> spells the sync actions as `ativo.criar`/`ativo.registrarMovimento`/
> `ativo.atualizarCotacao`. This service was built against the literal
> contract fixed in its implementation brief instead
> (`ativo.create`/`ativo.registerMovement`, dedicated
> `POST /ativos/{id}/cotacao`) since domain-api's HTTP layer for these
> aggregates does not exist yet at the time of writing — whichever team
> lands that layer first should reconcile the action names.

## brapi.dev quotes

`internal/quotes` calls `GET {ASSET_MANAGER_BRAPI_BASE_URL}/quote/{tickers}`
with `Authorization: Bearer ${ASSET_MANAGER_BRAPI_TOKEN}` (5s timeout).
Responses are cached in memory per ticker for `cotacaoTTL` (5 minutes).
**`ASSET_MANAGER_BRAPI_TOKEN` is an infrastructure secret injected by
Terraform — it is never present in this repository, only referenced by
name.**

### Fallback (FR-035)

If brapi.dev fails (network error, rate limit, unknown ticker) and
there is no valid cache entry, `GET /api/ativos` falls back to the
`ultima_cotacao`/`ultima_cotacao_em` domain-api already persisted for
that ativo and marks the item `"desatualizada": true`. This endpoint
never answers `5xx` solely because the external quote source is down.
`GET /api/cotacoes` has no `ativoId` to fall back through, so a ticker
that fails there comes back with an `"erro"` note instead of a price —
the request itself still answers `200`.

## Rentabilidade (`GET /api/ativos`)

Per position:

```
valorMercadoAtual       = quantidadeAtual × cotacaoAtual
custoTotal              = quantidadeAtual × custoMedio
proventosRecebidos      = soma de valor_provento nos movimentos tipo "provento"
rentabilidadeAbsoluta   = valorMercadoAtual + proventosRecebidos - custoTotal
rentabilidadePercentual = rentabilidadeAbsoluta / custoTotal (0 se custoTotal == 0)
```

## Environment

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8022` | listen port |
| `BIND_HOST` | *(empty)* | bind interface |
| `ASSET_MANAGER_FRONTEND_ORIGINS` | — | comma-separated CORS allowlist |
| `ASSET_MANAGER_ACCESS_ISSUER` | — | Cloudflare Access team domain |
| `ASSET_MANAGER_ACCESS_AUD` | — | Access application audience |
| `ASSET_MANAGER_ALLOWED_EMAILS` | — | defense-in-depth email allowlist |
| `ASSET_MANAGER_DEV_BYPASS_AUTH` | — | `1` to skip Access verification locally |
| `ASSET_MANAGER_DEV_USER_EMAIL` / `_NOME` | — | identity used under the dev bypass |
| `ASSET_MANAGER_DOMAIN_API_URL` | — | domain-api origin |
| `ASSET_MANAGER_DOMAIN_API_KEY` | — | domain-api API key |
| `ASSET_MANAGER_BRAPI_TOKEN` | — | brapi.dev bearer token (infra secret, never commit) |
| `ASSET_MANAGER_BRAPI_BASE_URL` | `https://brapi.dev/api` | brapi.dev origin |

## Development

```bash
go build ./...
go vet ./...
go test ./...
```
