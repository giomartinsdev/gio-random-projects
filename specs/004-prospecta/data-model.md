# Data Model: Prospecta

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Todos os dados vivem no **DB `domain`** (Postgres 17), em schemas prefixados
`prospecta_*`. A persistência é feita **exclusivamente** pelo par
`domain-api`/`domain-worker` — nenhum serviço do Prospecta tem `DATABASE_URL`
(regra de isolamento §1.1 do spec). Embeddings usam **pgvector**.

Convenções gerais: todo agregado tem `id uuid pk default gen_random_uuid()`,
`tenant_id uuid not null`, `created_at timestamptz not null default now()`,
`updated_at timestamptz not null default now()`. **RLS** por `tenant_id` em
todas as tabelas.

## 1. `prospecta_company`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `name` | text not null | razão social / nome fantasia |
| `site` | text | domínio |
| `description` | text | o que vende (usado pela IA) |
| `created_at` / `updated_at` | timestamptz | |

Índices: `(tenant_id)`, unique `(tenant_id, site)`.

## 2. `prospecta_icp`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `company_id` | uuid fk → company | |
| `definition` | text | ICP em linguagem natural |
| `signals` | text[] | ex.: `{"expansão de frota","novo CD"}` |
| `embedding` | vector(1536) | pgvector — gerado via 9router/embeddings |
| `created_at` | timestamptz | |

Índices: `(company_id)`, `ivfflat (embedding vector_cosine_ops)`.

## 3. `prospecta_campaign`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `company_id` | uuid fk | |
| `icp_id` | uuid fk → icp | |
| `name` | text | |
| `channels` | text[] | `{"email","whatsapp"}` |
| `status` | text | `draft`/`running`/`paused`/`done` |
| `approval_policy` | text | `human` (MVP) / `auto` (Fase 2) |
| timestamps | | |

Índices: `(tenant_id, status)`, `(company_id)`.

## 4. `prospecta_lead`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `campaign_id` | uuid fk | |
| `company_name` | text not null | |
| `domain` | text | dedup key junto de `company_name` |
| `segment` | text | |
| `channel` | text | canal previsto de abordagem |
| `fit` | int | 0..100 (CHECK) |
| `status` | text | `discovered`/`enriched`/`qualified`/`contacted`/`replied`/`meeting` |
| `source_url` | text | origem do sinal |
| `enriched` | jsonb | decisor, e-mail corporativo, etc. |
| timestamps | | |

Índices: unique `(tenant_id, domain, company_name)` (**dedup**), `(campaign_id,
status)`, `(tenant_id, fit desc)`.

## 5. `prospecta_message`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `lead_id` | uuid fk | |
| `channel` | text | `email`/`whatsapp` |
| `direction` | text | `out`/`in` |
| `content` | text | |
| `status` | text | `drafted`/`approved`/`sent`/`failed`/`blocked` |
| `external_id` | text | id na Evolution/e-mail |
| `sent_at` | timestamptz | |

Índices: `(lead_id)`, `(tenant_id, status)`.

## 6. `prospecta_conversation`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `lead_id` | uuid fk | |
| `thread_key` | text not null | agrupa a thread (unique por tenant) |
| `state` | text | `open`/`waiting`/`closed` |
| timestamps | | |

Índices: unique `(tenant_id, thread_key)` — base da **idempotência** de
`ReceiveReply`.

## 7. `prospecta_agent_run`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `campaign_id` | uuid fk | |
| `agent` | text | `prospector`/`researcher`/`composer`/`qualifier` |
| `state` | text | `running`/`done`/`failed` |
| `metrics` | jsonb | contadores, latência, custo |
| `started_at` / `ended_at` | timestamptz | |

Índices: `(campaign_id, state)`, `(tenant_id, started_at desc)`.

## 8. `prospecta_audit_log`

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS |
| `command` | text | ex.: `CreateCompany` |
| `status` | text | `ok`/`failed` |
| `payload` | jsonb | **PII scrubbing** aplicado |
| `error` | text | |
| `created_at` | timestamptz | |

Índices: `(tenant_id, created_at desc)`, `(command, status)`.

---

## Eventos ↔ tabelas

| Evento | Efeito no banco |
| --- | --- |
| `CompanyRegistered` | insert `prospecta_company` |
| `ICPDefined` | upsert `prospecta_icp` (+ embedding) |
| `CampaignStarted` | update `prospecta_campaign.status` |
| `LeadDiscovered` | upsert `prospecta_lead` (dedup) |
| `LeadEnriched` | update `prospecta_lead.enriched` |
| `LeadQualified` | update `prospecta_lead.fit/status` |
| `MessageDrafted` | insert `prospecta_message` (`drafted`) |
| `MessageApproved` | update `prospecta_message.status` |
| `MessageSent` | update `status=sent` + `external_id` |
| `ReplyReceived` | upsert `prospecta_conversation` + insert msg `in` |
| `MeetingBooked` | update `prospecta_lead.status=meeting` |
