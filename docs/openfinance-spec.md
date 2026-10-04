# Open Finance (Polp / Celcoin) — especificação

> **Status:** proposta para implementação · **Escopo:** conectar contas bancárias via
> Open Finance e sincronizar saldo + transações para o ledger do `finance`.
> **Provedor:** **Polp** (`polp.com.br`), produto **Celcoin v2** (`api.polp.com.br/api/v2`).
> O produto **Pluggy v1** está em fim de vida (descontinuado em 28/11/2026) e **não**
> é usado aqui.

Tudo abaixo foi conferido na documentação do provedor (`polp.com.br/docs/celcoin`)
em 2026-10-04 — quando divergir, a doc do Polp manda.

---

## 1. Objetivo e experiência

Na SPA (`finance.giomartins.dev`) entra uma **seção "Open Finance"** onde a pessoa:

1. escolhe o banco (lista de instituições do Polp);
2. informa o CPF (e CNPJ, se for conta PJ);
3. é redirecionada ao banco para **autorizar** a conexão (`url_to_authenticate`);
4. volta e vê a conta conectada com **saldo** e o **extrato importado**;
5. pode **revogar** a conexão.

O saldo da conta aparece no app; as transações do banco entram no mesmo ledger e
no mesmo dashboard do WhatsApp/tela — com a origem marcada (`OPEN_FINANCE_SYNC`),
para o extrato dizer de onde veio cada linha.

**Fora de escopo (v1):** cartões de crédito, empréstimos, financiamentos e
investimentos (o Polp entrega, mas o ledger do finance é de conta/extrato);
pagamentos (o Open Finance é read-only); a engine de conciliação além da
deduplicação por `external_id`.

---

## 2. Como o Polp funciona (o que importa)

Fonte: `https://api.polp.com.br/api/v2`.

### 2.1. Autenticação

Dois headers em **toda** rota (exceto `GET /institutions`, que é pública):

| Header | Valor |
| --- | --- |
| `x-api-client` | o **client id** (dashboard Polp) |
| `x-api-secret` | o **secret** (dashboard Polp, exibido uma vez) |

Erros: `401` credenciais ausentes/ inválidas · `402` plano inativo ou fatura em
atraso (inclui `payment_url`) · `403` conta pendente de aprovação.

No repo, os segredos vivem no cofre como `POLP_OF_CLIENT_ID` e
`POLP_OF_CLIENT_SECRET` e chegam aos serviços por variável de ambiente
(`POLP_OF_CLIENT_ID`/`POLP_OF_CLIENT_SECRET`), **nunca** no git.

### 2.2. Consentimento (o "conectar conta")

- **Criar:** `POST /consents`
  ```json
  {
    "institution_id": "<uuid>",
    "cpf": "12345678900",
    "cnpj": null,
    "cliente_user_id": "5521981962914",
    "products": ["ACCOUNT"],
    "avoidDuplicates": true
  }
  ```
  → `201` com `{ id, status, execution_status, products, url_to_authenticate,
  url_to_authenticate_expires_at, cliente_user_id, ... }`.
  `cliente_user_id` é o campo livre para correlacionar ao nosso usuário — usamos
  o **telefone** (o `user_id` do ledger).
- **Instituição:** `PERSONAL` → só `cpf`; `BUSINESS` → `cpf` do representante +
  `cnpj`; `BOTH` → `cpf` (pessoal) ou `cpf`+`cnpj` (empresarial).
- **Status** (`ConsentStatus`): `AWAITING_AUTHORIZATION` · `AUTHORISED` ·
  `REJECTED` · `EXPIRED`. Não expira sozinho: vale até revogar.
- **Execução** (`ConsentExecutionStatus`): `AWAITING_RESOURCES` (o banco ainda
  não mandou os dados; o Polp retenta a cada 10 min) · `SUCCESS` ·
  `PARTIAL_SUCCESS` (dados usáveis; enriquecimento de categoria/counterparty
  pendente).
- **Listar:** `GET /consents` (paginado por cursor) · **Obter:** `GET /consents/{id}`
  · **Revogar:** `DELETE /consents/{id}` · **Recriar:** `POST /consents/{id}/recreate`.

### 2.3. Instituições

`GET /institutions` (**pública**) → paginada; cada item tem `id`, `name`,
`logo_url`, `status` (`OPERATIONAL`/`MAJOR_OUTAGE`/`DEGRADED_PERFORMANCE`),
`type` (`PERSONAL`/`BUSINESS`/`BOTH`) e `credentials` (quais documentos aceita).
Para conectar, a instituição precisa estar `OPERATIONAL`.

### 2.4. Contas e saldo

`GET /consents/{consent}/accounts` → `data[]` com `id`, `consent_id`, `number`,
`branch_code`, `compe_code`, `type` (`CONTA_DEPOSITO_A_VISTA` / `CONTA_POUPANCA`
/ `CONTA_PAGAMENTO_PRE_PAGA`), `subtype`, `currency`, e:
- `balance` (`null` até sincronizar): `{ available_amount: {amount, currency},
  blocked_amount, automatically_invested_amount, update_date_time,
  has_reserved_balance, updated_at }`;
- `overdraft_limit`: limites de cheque especial.

Valores são sempre `{ "amount": "1500.00", "currency": "BRL" }` — **string
decimal**, nunca float (casa com o §3.4 do ledger).

### 2.5. Transações da conta

`GET /accounts/{account}/transactions` (cursor, 500/página) → `data[]` com:
`id`, `account_id`, `transaction_name`, `transaction_date_time` (ISO 8601),
`type` (`AccountTransactionType`: `PIX`, `TED`, `BOLETO`, `CARTAO`, `DEPOSITO`,
`SAQUE`, ...), `credit_debit_type` (`CREDITO`/`DEBITO`),
`transaction_amount {amount, currency}`, `counterparty {name, alias, tax_id}`
(pode ser `null` até o enriquecimento), `category_ref` (`TransactionCategory`,
a taxonomia da Polp), `created_at`, `updated_at`.

Filtros úteis: `fromCreatedAt`/`toCreatedAt`, `fromUpdatedAt`/`toUpdatedAt`,
`fromDate`/`toDate` (por `transaction_date_time`); combinados com **OR**.

### 2.6. Webhooks (fase 2)

O Polp publica eventos em `POST {seu endpoint}` com o corpo
`{ event, resource, resource_id, query_parameters }` (ex.:
`event=accounts.transactions`, `resource=accounts`, `resource_id=<conta>`,
`query_parameters=fromUpdatedAt=…`). O consumidor então **relê a listagem** com
esses filtros (não há payload com os dados). **A doc não descreve assinatura
HMAC** — então o webhook é tratado como *dica de frescor*, nunca como dado
confiável: valida-se por segredo no caminho + IP, e sempre se relê da API.

### 2.7. Frequências de sincronização (Polp)

`account.balance` 14×/dia · `account.transactions` 8×/dia ·
`account.identification` ~1×/8 dias · `account.overdraft_limits` 14×/dia.
Logo, um poll a cada **~10 min** cobre com folga o que o lado do Polp atualiza.

### 2.8. Sandbox

`POST /api/v2/sandbox/consents` (mesmas credenciais, mesmos campos) cria um
consentimento **auto-autorizado**, com dados fictícios, sem plano e sem
cobrança. Consulta-se pelo prefixo `/api/v2/sandbox`. É como os testes de
integração rodam sem tocar dinheiro real.

---

## 3. Arquitetura na casa

Respeita a regra de isolamento (§1.1 da spec do financeiro): a `finance-api` é
**ACL sem banco**; o `domain-worker` é o **único escritor**; nenhum destes tem
broker de comando além do que já existe.

```
┌───────────────┐   conectar conta    ┌──────────────┐  POST /consents   ┌────────┐
│ finance SPA   │ ──────────────────► │ finance-api  │ ────────────────► │  Polp  │
│ (Open Finance)│ ◄─ url_to_auth ──── │   (ACL)      │ ◄── id/url ─────── │ Celcoin│
└───────────────┘                     └──────┬───────┘                   └────┬───┘
                                             │ publica comando               │
                                             ▼                               │
                                     domain.commands                          │
                                             │                               │
                                             ▼                               │
                                     ┌──────────────┐  escreve               │
                                     │ domain-worker│ ─────────► Postgres   │
                                     └──────────────┘  finance_of_* + finance_transactions
                                             │ publica evento (outbox)
                                             ▼
                                     domain.events ──► finance-customersupport-worker (avisa no WhatsApp)

┌──────────────────────────────┐   GET /consents, /accounts,                │
│ finance-openfinance-worker    │   /accounts/{id}/transactions             │
│ (NOVO: conector, sem host)    │ ──────────────────────────────────────────┘
│ poll a cada ~10 min           │
└──────────────┬───────────────┘
               │ POST /commands (X-API-Key própria)
               ▼
        finance-api ──► domain-api ──► domain-worker ──► Postgres
```

**Divisão de responsabilidade:**

- **`finance-api` (ACL)** — guarda as credenciais Polp e faz o **ciclo de vida do
  consentimento**, que é síncrono e voltado ao usuário: listar instituições,
  criar/listar/revogar consentimento. Não persiste: cada mutação vira um comando
  (`finance.openfinance.*`) publicado no domain-api, aplicado pelo domain-worker.
- **`finance-openfinance-worker` (NOVO, Python, sem porta)** — o **conector**
  (o "Open Finance connector" que a §13 já previa). Em background, chama o Polp
  para cada consentimento `AUTHORISED`, lê contas + transações e as encaminha
  como comandos (saldo → `finance.openfinance.syncBalance`; transação →
  `finance.transaction.register` com `source=OPEN_FINANCE_SYNC`). Idempotente
  por `external_id`.
- **`domain-worker` (único escritor)** — aplica os comandos, grava as tabelas
  `finance_of_consents`/`finance_of_accounts`, e faz o insert idempotente das
  transações por `(source, external_id)`.
- **`domain-api`** — serve as leituras (consentimentos, contas, saldo) por GET.
- **`finance-customersupport-worker`** — já consome `domain.events`; passa a
  avisar no WhatsApp quando uma transação do Open Finance entra (o dedup por
  comando que já existe cobre o "não avisar duas vezes").

> **Por que um worker separado e não o `finance-api`:** o sync é um **loop de
> background** com estado (cursor de última sync, retry, backoff). A ACL é
> stateless e não tem onde guardar isso; é o mesmo motivo pelo qual o
> `clubs-ingest` existe separado do `clubs-api`.

---

## 4. Modelo de dados (Postgres `domain`, via domain-worker)

Todas as tabelas vivem no mesmo banco/schema `finance_*` (decisão §8.1 do
financeiro). Dinheiro segue `NUMERIC(14,2)`; nunca float.

### 4.1. `finance_of_consents` (nova)

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | UUID PK | id local (gerado pelo worker) |
| `polp_consent_id` | TEXT UNIQUE NOT NULL | o `id` do Polp |
| `user_id` | TEXT NOT NULL | telefone (o mesmo do ledger) |
| `institution_id` | TEXT NOT NULL | id Polp da instituição |
| `institution_name` | TEXT | desnormalizado para exibição |
| `status` | TEXT NOT NULL | `AWAITING_AUTHORIZATION`/`AUTHORISED`/`REJECTED`/`EXPIRED` |
| `execution_status` | TEXT | `AWAITING_RESOURCES`/`SUCCESS`/`PARTIAL_SUCCESS` |
| `products` | TEXT[] | `{ACCOUNT}` no v1 |
| `url_to_authenticate` | TEXT | a URL do banco |
| `url_expires_at` | TIMESTAMPTZ | |
| `created_at`/`updated_at` | TIMESTAMPTZ | |

Índice único `(user_id, institution_id)` quando `status='AUTHORISED'` (evita
duas conexões ativas ao mesmo banco). Índice `(user_id)`.

### 4.2. `finance_of_accounts` (nova)

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | UUID PK | id local |
| `polp_account_id` | TEXT UNIQUE NOT NULL | id Polp da conta |
| `consent_id` | UUID FK → `finance_of_consents(id)` | |
| `user_id` | TEXT NOT NULL | |
| `name` | TEXT | rótulo (instituição + tipo) |
| `type` | TEXT | `CONTA_DEPOSITO_A_VISTA`/… |
| `currency` | TEXT NOT NULL DEFAULT 'BRL' | |
| `balance_amount` | NUMERIC(14,2) | saldo disponível |
| `balance_updated_at` | TIMESTAMPTZ | |
| `created_at`/`updated_at` | TIMESTAMPTZ | |

Índice `(user_id)`.

### 4.3. `finance_transactions` (alteração)

Adicionar:

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `external_id` | TEXT | id da transação no provedor (Polp) |
| `of_account_id` | UUID | FK lógica → `finance_of_accounts(id)` |
| `counterparty` | TEXT | nome/alias enriquecido |

Índice único parcial de idempotência:
```sql
CREATE UNIQUE INDEX uq_finance_transactions_external
  ON finance_transactions (source, external_id)
  WHERE external_id IS NOT NULL;
```
É isto que faz o import do Open Finance ser **idempotente** (reprocessar o
mesmo extrato não duplica) — a mesma disciplina do `command_id`.

### 4.4. Categoria

A `category_ref` do Polp (taxonomia rica, ~200 valores) é mapeada para as
categorias do ledger (`Alimentação`, `Transporte`, `Contas`, ...) por uma tabela
de mapeamento estática no worker (prefixo → categoria), com fallback `Outros`.
O valor cru da Polp é preservado em `external_category` (coluna nova, TEXT) para
auditoria e para um mapa melhor depois.

---

## 5. Contrato (comandos e eventos)

Nova família `finance.openfinance.*` no contrato compartilhado
(`packages/finance-contracts`), aplicada pelo domain-worker:

| Action | Payload | Efeito |
| --- | --- | --- |
| `finance.openfinance.consentCreated` | `{user_id, polp_consent_id, institution_id, institution_name, status, execution_status, products, url_to_authenticate, url_expires_at}` | upsert em `finance_of_consents` |
| `finance.openfinance.consentUpdated` | `{polp_consent_id, status, execution_status}` | atualiza status |
| `finance.openfinance.accountSynced` | `{user_id, polp_consent_id, polp_account_id, name, type, currency, balance_amount, balance_updated_at}` | upsert em `finance_of_accounts` |
| `finance.transaction.register` (existente) | `...+ source=OPEN_FINANCE_SYNC, external_id, of_account_id, counterparty, external_category` | insert idempotente por `(source, external_id)` |

Eventos resultantes (já publicados pela outbox): `finance.transaction.registered`
(reaproveitado; o worker conversacional avisa) e, novo,
`finance.openfinance.consentUpdated` (para o SPA refletir status / o worker
avisar "conta conectada").

O contrato ganha as constantes em `finance_contracts.envelope` e o tipo de
`source` já existe (`OPEN_FINANCE_SYNC`).

---

## 6. Leituras (domain-api §4.2)

| GET | Devolve |
| --- | --- |
| `/finance/openfinance/consents?user_id=` | consentimentos do usuário (status, instituição, url pendente) |
| `/finance/openfinance/accounts?user_id=` | contas conectadas + saldo |
| `/finance/openfinance/institutions?query=` | **não** vai ao domain-api: é cache do Polp na ACL (ver §7) |

As duas primeiras são projeções read-only, como as demais, e são relayadas pela
`finance-api` no `POST /queries` (`finance.query.ofConsents`, `finance.query.ofAccounts`).

---

## 7. Superfície da `finance-api` (ACL)

Rotas novas (todas exigem sessão do SPA ou `X-API-Key` do conector):

| Rota | Faz |
| --- | --- |
| `GET /openfinance/institutions` | proxy a `GET /institutions` do Polp (público), com cache curto (5 min) |
| `POST /openfinance/consents` | cria no Polp (`POST /consents`, `cliente_user_id=telefone da sessão`), publica `consentCreated`, devolve `{consent_id, url_to_authenticate, status}` |
| `GET /openfinance/consents` | lê do domain-api (estado aplicado) |
| `POST /openfinance/consents/{id}/refresh` | relê `GET /consents/{id}` no Polp e publica `consentUpdated` (para o SPA ver `AUTHORISED`) |
| `DELETE /openfinance/consents/{id}` | `DELETE /consents/{id}` no Polp + publica `consentUpdated` (revogado) |
| `POST /openfinance/webhooks/polp` (fase 2) | recebe evento (segredo no caminho), publica um comando "sync agora" para o conector |

**Segredos:** `POLP_OF_CLIENT_ID`, `POLP_OF_CLIENT_SECRET` (cofre →
env). Sem eles, as rotas de Open Finance respondem `503` "não configurado" (o
resto do app segue).

---

## 8. O conector `finance-openfinance-worker`

- **Sem host, sem banco** (regra §1.1): é um loop Python.
- Config: `FINANCE_API_BASE_URL`, `FINANCE_API_KEY` (key própria em
  `FINANCE_API_KEYS`, rótulo `openfinance`), `POLP_OF_CLIENT_ID`,
  `POLP_OF_CLIENT_SECRET`, `POLP_API_BASE`
  (default `https://api.polp.com.br/api/v2`), `OF_POLL_SECONDS` (default 600),
  `OF_SANDBOX=1` (usa o prefixo `/sandbox` — testes).
- Loop: `GET /consents` (do Polp) → para cada `AUTHORISED`:
  `GET /consents/{id}/accounts` → comando `accountSynced`;
  para cada conta, `GET /accounts/{id}/transactions?fromUpdatedAt=<última>`;
  cada transação vira `finance.transaction.register` (via `finance-api`).
- **Estado do cursor:** o worker não tem banco; ele guarda o `fromUpdatedAt`
  por conta **em memória** e, na subida, faz um backfill de N dias
  (`OF_BACKFILL_DAYS`, default 30). A idempotência por `external_id` torna o
  reprocessamento inofensivo.
- Falha de rede/Polp não derruba o loop; erro por consentimento é logado e
  segue para o próximo.

---

## 9. SPA — seção "Open Finance"

Nova aba no painel:

- **Contas conectadas**: cards com banco, tipo, saldo, "última atualização", e
  botão **Revogar**.
- **Conectar conta**: botão → modal com (a) seletor de instituição (busca em
  `/openfinance/institutions`), (b) campo CPF/CNPJ conforme o `type` da
  instituição, (c) "Conectar" → abre `url_to_authenticate`. Ao voltar, o SPA
  chama `refresh` e reflete o status.
- **Status**: `AWAITING_AUTHORIZATION` (aguardando no banco), `AUTHORISED`
  (conectado), `AUTHORIZED → execution AWAITING_RESOURCES` ("o banco está
  enviando seus dados"), `EXPIRED`/`REJECTED` (com "reconectar").
- A tela reusa o shell/componentes shadcn já existentes.

---

## 10. Idempotência e conciliação (v1)

- **Dedup de transação:** `(source, external_id)` único. Reprocessar o extrato
  inteiro não duplica.
- **Dedup de conta/consent:** upsert por `polp_account_id`/`polp_consent_id`.
- **Alerta no WhatsApp:** a transação importada gera `finance.transaction.registered`;
  o `finance-customersupport-worker` já suprime a confirmação de comandos que
  ele mesmo originou — como o comando vem do conector, o usuário **recebe** o
  aviso (comportamento desejado).
- **Conciliação com lançamento manual** (a mesma compra anotada à mão e
  importada do banco) fica como **fase 2** (`TransactionFingerprint`): v1 não
  funde as duas, só marca a origem. Documentado como limitação.

---

## 11. Testes

| Camada | O que prova |
| --- | --- |
| Unit (ACL) | cliente Polp monta headers/URL; mapeia erros 401/402/403; `products=[ACCOUNT]`; CPF/CNPJ conforme `type`. |
| Unit (conector) | mapeamento `category_ref`→categoria; `CREDITO/DEBITO`→sinal; montagem do comando; cursor por `updated_at`. |
| Unit (domain-worker) | idempotência `(source, external_id)`; upsert de consent/account. |
| Integração (testcontainers) | contra o **sandbox do Polp** (`/sandbox/consents`), consent → conta → transação importada; reprocessar não duplica. |
| Contrato | o payload do webhook (`{event,resource,resource_id,query_parameters}`) e os comandos `finance.openfinance.*` batem com o contrato compartilhado. |
| E2E | conectar no sandbox e ver saldo+extrato no painel e a origem `OPEN_FINANCE_SYNC` no extrato. |

---

## 12. Riscos e limites (honestos)

| Risco | Mitigação |
| --- | --- |
| Webhook sem assinatura | tratar como dica; sempre reler a API; segredo no caminho + allowlist de IP. Fase 2. |
| Plano/fatura do Polp (`402`) | a ACL expõe o erro com o `payment_url`; o app mostra "integração indisponível". |
| Dados só após minutos (`AWAITING_RESOURCES`) | o SPA mostra "o banco está enviando seus dados"; o conector reprocessa. |
| Sem conciliação com manual | declarado fora do escopo v1; cada linha marca a origem. |
| Cursor em memória | backfill de N dias + dedup por `external_id` torna o reprocessamento seguro. |
| CPF/CNPJ (dado sensível) | nunca logado; transita direto para o Polp; não persistimos CPF — só o `polp_consent_id`. |

---

## 13. Rollout

1. Infra: env `POLP_OF_CLIENT_ID`/`POLP_OF_CLIENT_SECRET` na stack `finance`;
   key `openfinance` em `FINANCE_API_KEYS`; stack/CI do novo worker.
2. Schema (expand): colunas/tabelas acima; `expand-contract` (adiciona, não
   dropa).
3. ACL + worker + leituras + SPA atrás do sandbox (`OF_SANDBOX=1`) até validar.
4. Ligar produção; webhooks como fase 2.
