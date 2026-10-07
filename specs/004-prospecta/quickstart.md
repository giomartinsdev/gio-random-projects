# Quickstart: Prospecta

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Tasks**: [tasks.md](./tasks.md)

Como subir localmente e validar cada user story de ponta a ponta. Não confie no
check verde — confira o que está servindo.

## Pré-requisitos

- Docker + Docker Compose.
- Repo `.env` preenchido: `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`,
  `EVOLUTION_API_KEY`, `PROSPECTA_API_KEYS`, `NINEROUTER_BASE_URL`.
- Acesso à rede externa `apps` (os stacks `persistence`, `compute` já rodando).

## Subir

```bash
# 1. infra compartilhada (se ainda não estiver de pé)
cd modules/apps && docker compose up -d        # postgres, rabbitmq

# 2. stack do Prospecta
docker compose -f stacks/prospecta.yml up --build -d

# 3. schema
docker compose -f stacks/prospecta.yml run --rm prospecta-db-init
```

Serviços esperados: `prospecta-api` (8018), `prospecta-agent-worker` (sem porta),
`prospecta-frontend` (bucket).

## Smoke test

```bash
curl -s localhost:8022/healthz                       # {"status":"ok"}
curl -s -H "X-API-Key: $KEY" localhost:8022/companies | jq
```

## US1 — Empresa + ICP

```bash
KEY=dev-key
curl -s -X POST localhost:8022/companies -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Northwind Log","site":"northwindlog.com.br","description":"Gestão de frotas"}'
# → 202 { "id": "...", "status": "accepted" }

curl -s -X POST localhost:8022/companies/<ID>/icp -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"definition":"Logística B2B, 50–500 func., Sudeste","signals":["expansão de frota"]}'
# → 202

curl -s localhost:8022/companies/<ID> -H "X-API-Key: $KEY" | jq '.icp'
# → definição persistida (confirma leitura pelo par de domínio)
```

**Esperado**: após o comando, `GET` reflete o ICP (prova o `202` → worker →
Postgres). Sem `X-API-Key` → `401`.

## US2 — Campanha + Agente busca

```bash
curl -s -X POST localhost:8022/campaigns -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"company_id":"<ID>","name":"Logística Sudeste","channels":["email"]}'   # 202

curl -s -X POST localhost:8022/campaigns/<CID>/start -H "X-API-Key: $KEY"      # 202

sleep 30
curl -s "localhost:8022/leads?campaign_id=<CID>" -H "X-API-Key: $KEY" | jq '.items | length'
# → > 0 (agente encontrou e qualificou leads; fit preenchido; source_url presente)
```

**Esperado**: o worker loga o run; `prospecta_agent_run` tem estado `done`;
leads têm `fit` e `enriched`. Com o 9router derrubado, o run vai para `failed`
sem travar a fila.

## US3 — Abordagem e-mail/WhatsApp

```bash
# aprovar uma mensagem redigida
curl -s -X POST localhost:8022/messages/<MID>/approve -H "X-API-Key: $KEY"   # 202
# → Evolution recebe POST /message/sendText/{instance} (apikey); conferir no log

# simular resposta do cliente publicando na fila do Evolution
# (payload v2.3.7 com remoteJid e message.conversation, fromMe=false)
curl -s localhost:8022/conversations -H "X-API-Key: $KEY" | jq
# → thread aparece com a resposta
```

**Esperado**: opt-out bloqueia o envio (`MessageBlocked`) e **não** contorna;
`fromMe=true` é ignorado; grupo `@g.us` recusado.

## US4 — Cockpit & atividade

```bash
curl -N localhost:8022/agent/activity -H "X-API-Key: $KEY"
# → stream SSE: event: agent / data: {...} enquanto um run roda
```

**Esperado**: feed ao vivo emite em ordem; desconectar não vaza goroutine;
`GET /companies` e métricas refletem o estado.

## Testes (feature-first TDD)

```bash
# Go
cd modules/apps/prospecta-api && go test ./...

# Python (worker)
cd modules/apps/prospecta-agent-worker && pytest

# contratos
cd packages/prospecta-contracts && pytest
```
Testes usam testcontainers reais (Postgres, RabbitMQ, upstream HTTP de
Evolution/9router). Cobertura `< 90%` falha o build.

## Deploy (produção)

```bash
git add . && git commit -m "feat(prospecta): ..." && git push
# os 3 workflows (go / python / ts-frontend) buildam e publicam; o -replace
# recria o container; conferir:
curl -s https://prospecta-api.giomartins.dev/healthz
curl -s https://prospecta.giomartins.dev/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```
