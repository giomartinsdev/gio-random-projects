# Contract: `prospecta-agent-worker` (Python 3.12, sem porta, sem banco)

O núcleo agêntico. **Sem porta, sem hostname, sem `DATABASE_URL`, sem driver de
banco** — espelha `finance-customersupport-worker`. Fala broker (RabbitMQ) e HTTP
tipado (X-API-Key) com a `prospecta-api`.

## Entradas (broker)

| Fila / routing key | Origem | Ação do worker |
| --- | --- | --- |
| `ProspectRequested` (exchange `domain.events`) | `domain-worker` | inicia o run: planeja e dispara tools |
| `LeadQualified` (`domain.events`) | `domain-worker` | redige abordagem → `MessageDrafted` |
| `MessageApproved` (`domain.events`) | `domain-worker` | envia pela Evolution/e-mail |
| `evolution.messages.upsert` (exchange `evolution`) | Evolution API (stack `compute`) | parse → `ReplyReceived` |

## Saídas

- **Comandos HTTP** para `prospecta-api` (`POST`, `X-API-Key`): `UpsertLead`,
  `QualifyLead`, `DraftMessage`, `SendMessage`, `ReceiveReply`, `BookMeeting`.
- **Eventos próprios** no exchange `domain.events`: `LeadDiscovered`,
  `LeadEnriched`, `MessageDrafted`, `MessageSent`, `ReplyReceived`,
  `MeetingBooked`, `MessageBlocked`.

## Parse do payload Evolution (v2.3.7)

```json
{
  "event": "messages.upsert",
  "instance": "web-businesses",
  "data": {
    "key": { "remoteJid": "5521981962914@s.whatsapp.net", "fromMe": false },
    "message": { "conversation": "texto" },
    "pushName": "Carlos Menezes",
    "messageTimestamp": 1759800000
  }
}
```
Regras: `fromMe=true` → **ignora**; `@g.us` (grupo) → **recusa**; `number` =
`remoteJid` sem o sufixo `@s.whatsapp.net` (ver `jid_to_number`).

## Saída WhatsApp (Evolution)

```
POST {EVOLUTION_API_URL}/message/sendText/{instance}
headers: { "apikey": "{EVOLUTION_API_KEY}", "Content-Type": "application/json" }
body:    { "number": "5521981962914", "text": "Olá, [Nome]..." }
```
Instância via `EVOLUTION_INSTANCE` (default `web-businesses`). Falha ≥ 300 →
levanta (o run decide retry/falha); **nunca** silencia.

## 9router (IA — única porta de IA)

```
POST {NINEROUTER_BASE_URL}/chat/completions        # OpenAI-compatible
Authorization: Bearer {NINEROUTER_API_KEY}          # se configurada (Vault)
body: { "model": "...", "messages": [...], "stream": false }
```
Usado para: planejar run, extrair sinais do ICP, redigir abordagem, embeddings.
Fallback + timeout curto; budget/custo por tenant.

## Tools (adapters isolados)

| Tool | Contrato | Guardrails |
| --- | --- | --- |
| `web.search` | `query → [{title,url,snippet}]` | `robots.txt`, rate-limit, UA identificável |
| `web.scrape` | `url → {text, meta}` | só página pública, nunca atrás de login |
| `enrich.company` | `domain/name → {decisor,email,cnpj,...}` | normaliza p/ `enriched{}` |
| `send.message` | `channel,to,text → {external_id}` | consulta opt-out **antes** |

## Env obrigatórias (bootstrap falha se faltar — padrão do worker financeiro)

```
RABBITMQ_URL   EVOLUTION_API_URL   EVOLUTION_API_KEY   EVOLUTION_INSTANCE
NINEROUTER_BASE_URL   PROSPECTA_API_URL   PROSPECTA_API_KEY
OTEL_EXPORTER_OTLP_ENDPOINT
```

## Guardrails

- `guardrails.py`: PII scrubbing **antes** de chamar o 9router; telefone/e-mail
  nunca completos em log/trace.
- Consulta de opt-out **antes** de todo `send.message`; bloqueio → `MessageBlocked`
  (nunca contorna).
- `policy.approval=human` no MVP: **nenhum** envio sem `MessageApproved`.
