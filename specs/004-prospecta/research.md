# Research: Prospecta

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Decisões técnicas que precisam estar fechadas antes de implementar. Marcadas
como **FECHADO** (com a decisão) ou **ABERTO** (a resolver na fase indicada).

## R1 — Orquestração dos agentes

**FECHADO.** Máquina de estados própria sobre os eventos de domínio, não um
framework pesado. O run é: `plan → search → enrich → qualify → draft`, cada
transição publicando/consumindo evento e persistindo no `prospecta_agent_run`.
Motivo: o repo já é event-driven e o worker é reativo a filas; um LangGraph
completo adicionaria um runtime opaco e difícil de observar (violando
"System Status Visibility"). O estado vive no banco, não na memória do processo.

- Retry com backoff exponencial + circuit-breaker por dependência.
- Idempotência por `run_id` + chave de negócio (ex.: `lead.domain+name`).

## R2 — 9router (IA)

**FECHADO.** Interface OpenAI-compatible: `POST {NINEROUTER_BASE_URL}/chat/completions`,
base `https://ai.giomartins.dev/v1`. O 9router é o **único** provider (nenhum
CLI/provider baked-in). Env: `NINEROUTER_BASE_URL`; `REQUIRE_API_KEY=false` hoje,
mas o cliente envia `Authorization: Bearer` se a chave estiver configurada (Vault).

- Usado para: planejar o run, extrair sinais do ICP, redigir a abordagem,
  embeddings do ICP (endpoint de embeddings do 9router).
- Fallback: timeout curto + retry; em falha persistente, o run vai para
  `failed` e emite métrica (não trava a fila).
- Budget/custo por tenant registrado em `prospecta_agent_run.metrics`.

## R3 — Tools de busca e enriquecimento

**FECHADO (interfaces); ABERTO (provedores).**

- `web.search` — busca de prospects. Provedores: SerpAPI / Brave Search API.
  Respeita `robots.txt`, rate-limit por domínio e user-agent identificável.
- `web.scrape` — leitura de página pública (nunca atrás de login).
- `enrich.company` — dados de empresa/decisor: Clearbit / Apollo / consulta de
  **CNPJ** (Receita). Normaliza para `enriched{}`.

Decisão de provedor fica para a task T036 (com o orçamento definido). Cada tool é
um adapter isolado, testável contra um upstream HTTP real em container.

## R4 — Dedup de leads

**FECHADO.** Chave natural `(tenant_id, domain, company_name)` com unique index.
Upsert idempotente: um lead já visto é atualizado (`enriched`/`fit`), nunca
duplicado. Dedup também vale para mensagens (por `thread_key`).

## R5 — WhatsApp (Evolution API)

**FECHADO.** Reusar exatamente o contrato já provado em
`finance-customersupport-worker/gateway/evolution.py`:

- Saída: `POST {EVOLUTION_API_URL}/message/sendText/{instance}`, header
  `apikey`, corpo `{"number":"<E.164 sem +>","text":"..."}`.
- Entrada: consome a fila **`evolution.messages.upsert`** do RabbitMQ (exchange
  topic `evolution`, publicado pela Evolution, stack `compute`).
- Payload v2.3.7: `{event, instance, data:{key:{remoteJid, fromMe},
  message:{conversation|extendedTextMessage.text}, pushName, messageTimestamp}}`.
- `fromMe=true` é ignorado (é a própria mensagem do bot); `@g.us` é recusado
  (não é número).

## R6 — E-mail (D9)

**ABERTO — decidir antes do M4.** Candidatos: SES (default) vs Postmark.
Requisitos: SPF/DKIM/DMARC no domínio, warmup, tratamento de bounce/complaint,
opt-out no rodapé. A interface do adapter é `send(to, subject, body, headers)`.

## R7 — LGPD / conformidade

**FECHADO.**

- Base legal: dados **públicos** de empresas (interesse legítimo B2B), com
  opt-out claro em cada abordagem.
- Lista de opt-out consultada **antes** de todo envio; bloqueio nunca é
  contornado (publica `MessageBlocked`).
- PII scrubbing antes de mandar contexto ao 9router; telefone/e-mail nunca
  completos em logs/traces.
- Aprovação humana por padrão (`policy.approval=human`).

## R8 — Observabilidade

**FECHADO.** OTLP para `alloy:4318` (padrão do repo), `OTEL_SERVICE_NAME` por
serviço. Métricas de negócio: runs por campanha, leads/dia, taxa de resposta,
opt-outs, erros de 9router/Evolution. Dashboard no Grafana.

## R9 — Testes

**FECHADO.** Feature-first TDD com `pytest-bdd` + testcontainers (Postgres,
RabbitMQ, upstream HTTP de Evolution/9router). Go: `httptest` + testcontainers.
Cobertura `--cov-fail-under=90`. Ver `.claude/skills/feature-first-tdd/SKILL.md`.
