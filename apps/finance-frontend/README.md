# finance-frontend

A tela do bounded context financeiro — SPA React estática. Não roda como
container: o build (`dist/`) é espelhado direto num bucket do MinIO, e o
`ingress` serve esse bucket pela API S3 do MinIO (mesmo padrão de
`tela-frontend`/`clubs-frontend`/`hub-frontend`).

Esta tela **não tem lógica financeira própria**: ela fala por CORS com a
[`finance-api`](../finance-api/README.md) (a ACL do contexto), que valida o
comando e o relaya ao `domain-api`, o dono da persistência. Ou seja, a SPA
não conhece banco nem broker — só a superfície HTTP da ACL
(`GET /healthz`, `POST /commands`).

## O que a tela faz hoje

Uma tela só, suficiente para operar a **fatia 1**:

- **Liveness** da `finance-api` (`GET /healthz`), com um botão para reverificar.
- **Chave de API** (`X-API-Key`): o campo em que o operador cola a key que o
  identifica na auditoria. Fica **só em `sessionStorage`** — nunca é embutida
  no bundle nem enviada a outro lugar.
- **Enviar comando**: um formulário com o envelope `{action, payload}` e três
  presets (despesa, receita, orçamento). Os nomes de action vêm do contrato
  compartilhado (`packages/finance-contracts`), então um typo vira `422` da
  API, não um erro silencioso.

O resultado exibe os três desfechos documentados do relay, que **não são a
mesma coisa** (spec §4.1):

| `status` | HTTP | Significado |
| --- | --- | --- |
| `written` | 200 | aplicado — `entity_id` presente |
| `failed` | 422 | rejeitado; tentar de novo do mesmo jeito falha igual |
| `queued` | 504 | o `domain-api` desistiu de esperar, mas **o comando segue na fila e pode ser aplicado** — timeout não é falha |

A leitura (dashboards, extrato — spec §4.2) e o worker conversacional são
fatias seguintes; a superfície de escrita já é real.

## Rodando local

```bash
npm install
npm run dev
```

`vite.config.ts` proxia `/healthz` e `/commands` para
`http://localhost:8018` — suba a `finance-api` nessa porta (ela precisa de
`DOMAIN_API_BASE_URL`, `DOMAIN_API_KEY` e `FINANCE_API_KEYS`; veja o README
dela) e não precisa setar `VITE_FINANCE_API_URL` nenhuma para desenvolver.

## Build

```bash
npm run build   # tsc -b && vite build -> gera dist/
```

Em produção, `VITE_FINANCE_API_URL` (ex.: `https://finance.giomartins.dev`)
é passado como variável de ambiente do `npm run build` — veja
`.github/workflows/ts-frontend-ci-cd.yml`. O endpoint público de OTLP
(`VITE_OTEL_EXPORTER_OTLP_ENDPOINT`) alimenta `src/telemetry.ts`; sem ele a
telemetria fica desligada (é o caso do dev local).
