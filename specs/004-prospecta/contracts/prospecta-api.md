# Contract: `prospecta-api` (BFF/ACL, Go)

**Host:** `prospecta-api.giomartins.dev` · **Porta:** 8022 · **Auth:** `X-API-Key`
(header obrigatório; sem Access na frente) · **Sem banco.**

Regra: **leitura** (`GET`) passa pelo par de domínio e devolve projeção JSON;
**escrita** (`POST`) valida no `prospecta-api`, publica o comando no RabbitMQ
(envelope `{action, payload}`) e devolve **202 Accepted** com o `id` do recurso.
Erros: `401` sem/`X-API-Key` inválida · `404` id inexistente · `422` payload
inválido (sem escrita parcial).

## Company & ICP

### `POST /companies` → 202
```json
{ "name": "Northwind Log", "site": "northwindlog.com.br",
  "description": "Software de gestão de frotas e roteirização." }
```
Comando `CreateCompany`. Resposta `202 { "id": "...", "status": "accepted" }`.

### `GET /companies/{id}` → 200
```json
{ "id": "...", "name": "Northwind Log", "site": "northwindlog.com.br",
  "description": "...", "icp": { "definition": "...", "signals": ["expansão de frota"] } }
```
`404` se não existir.

### `POST /companies/{id}/icp` → 202
```json
{ "definition": "Logística B2B, 50–500 funcionários, Sudeste, expandindo frota.",
  "signals": ["abertura de novo CD", "expansão de frota"] }
```
Comando `DefineICP` (gera embedding via 9router). `422` se `definition` vazio.

## Campaigns

### `POST /campaigns` → 202
```json
{ "company_id": "...", "name": "Logística Sudeste", "channels": ["email","whatsapp"] }
```
Comando `CreateCampaign`.

### `GET /campaigns` → 200
`{ "items": [ { "id","name","status","channels","leads_count" } ], "next": null }`
(paginado).

### `GET /campaigns/{id}` → 200 · **`POST /campaigns/{id}/start` → 202**
`start` publica `StartCampaign` + `ProspectRequested`. `422` se a campanha não
tiver ICP.

## Leads

### `GET /leads?campaign_id=&status=&fit_min=` → 200
```json
{ "items": [ { "id","company_name","segment","channel","fit","status","source_url" } ],
  "next": null }
```

### `GET /leads/{id}` → 200
Inclui `enriched{}`, timeline e última mensagem. `404` se não existir.

### `POST /leads/{id}/qualify` → 202
Comando `QualifyLead` (ajuste manual de fit pelo operador). `fit` fora de 0..100
→ `422`.

## Conversations & Messages

### `GET /conversations` → 200
`{ "items": [ { "id","lead_id","company_name","channel","last_message","unread","state" } ] }`

### `GET /conversations/{id}` → 200
Thread completa (mensagens `in`/`out` em ordem).

### `POST /messages` → 202
```json
{ "lead_id": "...", "channel": "email", "content": "..." }
```
Comando `DraftMessage`/`SendMessage`. Se `policy.approval=human`, entra como
`drafted`. `422` sem `content`.

### `POST /messages/{id}/approve` → 202
Comando `ApproveMessage` → dispara envio (Evolution/e-mail). `409` se a mensagem
não estiver em `drafted`.

## Activity (SSE)

### `GET /agent/activity` → `text/event-stream`
Emite eventos de `prospecta.agent_run` ao vivo:
```
event: agent
data: {"run_id":"...","agent":"prospector","state":"running","metric":{"found":12}}
```
Cliente que desconecta tem a goroutine encerrada (sem vazamento).

## Health

### `GET /healthz` → 200 `{ "status": "ok" }`
Conferido por `curl` no deploy (`docs/novo-app-ci-cd.md` §9).
