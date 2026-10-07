# Requirements Checklist: Prospecta

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Tasks**: [tasks.md](../tasks.md)

Checklist de aceite — cada item deve ser verificável por teste, `curl` ou inspeção.

## Funcional

- [ ] Cadastro de empresa persiste e é lido de volta (`GET /companies/{id}`).
- [ ] ICP definido em linguagem natural é persistido e gera embedding (pgvector).
- [ ] Criar campanha a partir do ICP e iniciá-la publica `ProspectRequested`.
- [ ] Agente busca, qualifica (fit 0..100) e enriquece leads com `source_url`.
- [ ] Abordagem é redigida por lead, personalizada, com rodapé de opt-out.
- [ ] Envio por e-mail **e** WhatsApp com aprovação humana (`policy.approval=human`).
- [ ] Resposta do cliente volta pro inbox (`GET /conversations`).
- [ ] Cockpit mostra métricas, painel de agentes e feed ao vivo (SSE).

## Não-funcional / Arquitetura

- [ ] **Nenhum** serviço novo tem `DATABASE_URL`/driver de banco (§1.1).
- [ ] Toda escrita é comando `202`; o `domain-worker` é o único escritor.
- [ ] IA 100% pelo **9router**; nada de provider baked-in.
- [ ] WhatsApp 100% pela **Evolution API**; sem reimplementar Baileys.
- [ ] Broker é o RabbitMQ do `persistence`; sem broker próprio.
- [ ] Rede externa `apps`; sem rede nova.
- [ ] `packages/prospecta-contracts` é a única fonte de envelope/eventos.

## Conformidade (LGPD)

- [ ] Opt-out é consultado **antes** de todo envio e nunca contornado.
- [ ] PII scrubbing antes do 9router; sem telefone/e-mail completos em log/trace.
- [ ] Scraping respeita `robots.txt`/rate-limit e só dados públicos.
- [ ] Todo comando tem audit trail (sucesso **e** falha) com payload scrubbed.
- [ ] Aprovação humana no MVP; envio automático só na Fase 2 atrás de flag.

## Testes (feature-first TDD)

- [ ] Cada serviço tem `.feature` + steps `pytest-bdd` com testcontainers reais.
- [ ] Cada cenário cobre **positivo**, **negativo** e **edge**.
- [ ] Idempotência verificada (comando/lead/reply duplicados = 1 efeito).
- [ ] `--cov-fail-under=90` respeitado em todo serviço Python.
- [ ] Go: integração `httptest`/testcontainers no molde de `domain-worker`.

## Deploy

- [ ] 3 apps descobertos pelos pipelines certos (go / python / ts-frontend).
- [ ] `prospecta-frontend` em `ALLOWED_APPS` **e** `on.push.paths`.
- [ ] Módulo Terraform + `module` no `main.tf` + ingress em `locals.tf`.
- [ ] SPA em `excluded_hostnames` (pública de propósito; justificativa na linha).
- [ ] Entrada no `case` do `-replace` (o passo que quebra silenciosamente).
- [ ] Deploy conferido por `curl` (healthz + hash do bundle), não pelo check verde.

## Observabilidade

- [ ] OTLP para `alloy:4318` e `OTEL_SERVICE_NAME` nos 3 serviços.
- [ ] Dashboard no Grafana: runs, leads/dia, taxa de resposta, opt-outs, erros.
- [ ] Segredos no Vault (`EVOLUTION_*`, `NINEROUTER_*`, `PROSPECTA_API_KEYS`).
