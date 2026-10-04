# finance-whatsapp-worker

O worker conversacional do bounded context financeiro. Roda como um processo
Python **sem porta e sem host** (não serve HTTP): ele **consome** os eventos da
[Evolution API](../../../stacks/compute.yml) pelo RabbitMQ e **envia** a resposta
por HTTP de volta à Evolution. Não tem banco, não tem `DATABASE_URL` e **nunca**
publica comando — a persistência é do stack `domain` (spec §1.1).

## O caminho de uma mensagem

```
WhatsApp ──► Evolution API (stack compute, Baileys)
                 │ publica no RabbitMQ: exchange topic `evolution`,
                 │ routing key `evolution.messages.upsert`
                 ▼
        fila evolution.messages.upsert
                 │ o worker consome (AMQP)
                 ▼
      finance-whatsapp-worker
        ├─ NLU por regras (nlu/parser.py)  → intent + payload
        ├─ POST finance-api /commands       → {action, payload} (X-API-Key)   [escrita]
        ├─ POST finance-api /queries        → leitura (§4.2)                  [leitura]
        ├─ render (rendering/text.py)       → texto do WhatsApp
        ├─ chart (rendering/chart.py)       → PNG do fluxo de caixa
        └─ POST Evolution sendText/sendMedia/{instance} → resposta
```

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
  `ENTRYPOINT ["python", "-m", "finance_whatsapp_worker.main"]`.
