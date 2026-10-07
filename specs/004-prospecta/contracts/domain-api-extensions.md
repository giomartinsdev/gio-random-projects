# Contract: extensões no `domain-api` / `domain-worker`

O par de domínio continua o **único dono do banco** e o **único escritor**. O
Prospecta adiciona comandos e eventos, no mesmo envelope da casa.

## Envelope (padrão de `packages/finance-contracts`)

```json
{ "action": "CreateCompany", "payload": { "...": "..." } }
```
- `POST /commands` (assíncrono) → publica em `domain.commands` → **202**.
- `POST /commands/sync` → **200/422/504** (quando a porta síncrona existir).
- `GET /*` → leitura de projeções (read-only).

## Comandos novos

| `action` | `payload` (mínimo) | Escreve |
| --- | --- | --- |
| `CreateCompany` | `name, site, description, tenant_id` | `prospecta_company` |
| `DefineICP` | `company_id, definition, signals[]` | `prospecta_icp` (+embedding) |
| `CreateCampaign` | `company_id, icp_id, name, channels[]` | `prospecta_campaign` |
| `StartCampaign` | `campaign_id` | `prospecta_campaign.status=running` |
| `RequestProspect` | `campaign_id` | `prospecta_agent_run` (open) |
| `UpsertLead` | `campaign_id, company_name, domain, fit, source_url` | `prospecta_lead` (dedup) |
| `QualifyLead` | `lead_id, fit` (0..100) | `prospecta_lead.fit/status` |
| `DraftMessage` | `lead_id, channel, content` | `prospecta_message` (drafted) |
| `ApproveMessage` | `message_id` | `prospecta_message.status=approved` |
| `SendMessage` | `message_id, external_id` | `prospecta_message.status=sent` |
| `ReceiveReply` | `thread_key, content, external_id` | `prospecta_conversation` + msg `in` |
| `BookMeeting` | `lead_id, when` | `prospecta_lead.status=meeting` |

Invariantes: `fit` em `0..100` (senão `422`); `ApproveMessage` só a partir de
`drafted` (senão `409`); `UpsertLead`/`ReceiveReply` **idempotentes**.

## Eventos publicados (exchange `domain.events`, fanout)

`CompanyRegistered`, `ICPDefined`, `CampaignStarted`, `ProspectRequested`,
`LeadDiscovered`, `LeadEnriched`, `LeadQualified`, `MessageDrafted`,
`MessageApproved`, `MessageSent`, `ReplyReceived`, `MeetingBooked`.

Publicação por **outbox durável** (grava pendente antes do publish; relay
reenvia — at-least-once), no padrão de `docs/architecture.md` §3.

## Audit

Todo comando vira `prospecta_audit_log` (sucesso **ou** falha), com `payload` já
passado por **PII scrubbing**. Mesmo padrão de auditoria do `domain-worker`.

## Migrations

DDL dos schemas `prospecta_*` em [../data-model.md](../data-model.md), aplicada
pelo one-shot `prospecta-db-init` (T020), no espírito do `evolution-db-init`.
