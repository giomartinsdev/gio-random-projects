# finance-customersupport-worker

O worker conversacional do bounded context financeiro — o **encarregado do
atendimento ao cliente**. Roda como um processo Python **sem porta e sem host**
(não serve HTTP) e tem **dois consumidores concorrentes**:

1. `evolution.messages.upsert` — o que o cliente **manda** pelo WhatsApp
   (comandos e leituras). Responde pelo gateway do Evolution.
2. `domain.events` — o que o sistema **aplicou** (o domain-worker publica toda
   transação concluída via outbox). O worker avisa o cliente: confirmação de
   lançamento, transferência e, principalmente, o **alerta de orçamento** que
   ninguém tinha como mandar antes.

Não tem banco, não tem `DATABASE_URL` e **nunca** publica comando — a
persistência é do stack `domain` (spec §1.1).

## O caminho de uma mensagem

```
WhatsApp ──► Evolution API (stack compute, Baileys)
                 │ publica no RabbitMQ: exchange topic `evolution`,
                 │ routing key `evolution.messages.upsert`
                 ▼
        fila evolution.messages.upsert
                 │ o worker consome (AMQP)
                 ▼
      finance-customersupport-worker
        ├─ NLU por regras (nlu/parser.py)  → intent + payload
        ├─ POST finance-api /commands       → {action, payload} (X-API-Key)   [escrita]
        ├─ POST finance-api /queries        → leitura (§4.2)                  [leitura]
        ├─ render (rendering/text.py)       → texto do WhatsApp
        ├─ chart (rendering/chart.py)       → PNG do fluxo de caixa
        └─ POST Evolution sendText/sendMedia/{instance} → resposta

domain-worker ──► domain.events (fanout, outbox §4.3)
                 │ o worker TAMBÉM consome (AMQP) — atendimento proativo
                 ▼
        fila finance.customersupport.events
                 │
                 ▼
      finance-customersupport-worker
        └─ render_event (rendering/events.py) → aviso: confirmação/alerta
           └─ POST Evolution sendText/{instance} → mensagem proativa
```

## Atendimento proativo (eventos de domínio)

O worker assina `domain.events` e, por evento, manda ao cliente (roteando pelo
`payload.user_id`, que é o telefone):

| evento | mensagem |
|---|---|
| `finance.transaction.registered` | confirmação do lançamento |
| `finance.transfer.completed` | transferência concluída |
| `finance.transaction.categorized` | categoria atualizada |
| `finance.budget.thresholdReached` | ⚠️ aviso (50/80%) / 🚨 estouro (100%) |

Idempotente por `event_id` (o envelope carrega `event_id`/`command_id`): a mesma
entrega reentregue é no-op. Um evento de outra família é ignorado.

Detalhes que importam:

- **Eventos irrelevantes são no-op.** Só `messages.upsert` é processado; o eco
  das próprias respostas (`data.key.fromMe`) é ignorado, grupos (`@g.us`) também,
  e mensagem sem texto (áudio/imagem) não quebra o loop.
- **At-least-once → idempotente por `data.key.id`.** A mesma mensagem entregue
  duas vezes tem efeito único.
- **Timeout da finance-api ≠ falha.** Um `504` vira "está na fila, pode ser
  confirmada"; só `written` (200) é confirmação. Um `422` vira uma recusa
  honesta.
- **Falha no envio não derruba o consumo** (spec §12.9): o log registra e o loop
  segue.

## NLU por regras (sem LLM no caminho crítico)

O parser cobre o vocabulário do §5.1 com regex determinístico — testável por
golden file e sem rede. Hoje entende:

- *"Gastei 45 no almoço"* → despesa R$ 45,00, Alimentação
- *"Recebi 3500 de freela"* → receita R$ 3.500,00, Renda Extra
- *"paguei 120 de luz no nubank"* → despesa R$ 120,00, Contas
- *"orçamento de 600 pra alimentação"* → `finance.budget.setCategory`

### Leituras (§4.2, §5.2)

O worker também entende pedidos de consulta e responde com um card de texto
(ou PNG):

- *"Como estão meus gastos este mês?"* / *"resumo"* / *"saldo"* →
  `finance.query.monthlyDashboard` → card de receitas/despesas/saldo + top
  categorias com barra + alertas de orçamento.
- *"extrato"* → `finance.query.categoryBreakdown` → lista detalhada.
- *"gráfico"* → `finance.query.cashFlowHistory` → PNG do fluxo de caixa, enviado
  por `sendMedia`.

As leituras viajam por `POST /queries` (não `/commands`) e não têm ambiguidade:
200 é a projeção, qualquer outra coisa é erro. O PNG é determinístico
(stdlib `zlib`, sem lib de plotagem) e testado por golden file (§12.4).

O que não casa vira `desconhecido` e o worker pede para reformular — **nunca
inventa** uma transação. O valor sai sempre como **string decimal exata** (o
domínio proíbe `float`, §3.4).

## Rodando local

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e ../../../packages/finance-contracts -e ".[dev]"
.venv/bin/python -m pytest -q
```

Os testes de integração (`tests/features/`) sobem um RabbitMQ e um stub HTTP
finance-api/Evolution em containers reais (testcontainers) — o que se testa é a
travessia de rede, não um mock dela.

## Runtime

- env: `FINANCE_API_BASE_URL`, `FINANCE_API_KEY`, `RABBITMQ_URL`,
  `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`
  (`web-businesses` por padrão), `FINANCE_API_TIMEOUT_S`,
  `FINANCE_WORKER_LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME`.
- proibido: `DATABASE_URL` e qualquer driver de banco (provado em
  `tests/test_isolation.py`).
- build context: a **raiz do repo**, para alcançar `packages/finance-contracts`.
  `ENTRYPOINT ["python", "-m", "finance_customersupport_worker.main"]`.
