# finance-api

The **ACL of the finance bounded context**: it validates the WhatsApp
worker's commands, translates each one into the house `{action, payload}`
envelope, and relays it to `domain-api`, which owns persistence. Per spec
§1.1 it has **no database and no broker** — no driver, no `DATABASE_URL` —
and `tests/test_isolation.py` enforces that structurally rather than
trusting it.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Liveness. Public, no key — what §10.6 curls after a deploy. |
| `POST /commands` | The default write door. Validates and relays on the **async** path: `202 {status:"accepted"}` from `domain-api`'s `/commands`; the worker applies it. |
| `POST /commands/sync` | Same envelope, explicitly blocking path. `200 written` / `422 failed` / `504 queued`. |
| `POST /queries` | The read door (§4.2). Validates the query, relays it to a `domain-api` GET, and returns the projection. `422` bad query / `504` client timeout / `502` upstream. |

All routes need `X-API-Key`; the key's **label** names the caller in the
audit trail (§12.3).

## Writes: async by default

The house default is asynchronous (§4.1): `POST /commands` relays to
`domain-api`'s `POST /commands`, which publishes the envelope and answers
`202 accepted`. The ACL passes that 202 straight back; the worker does not wait
for the write to be durable. `POST /commands/sync` is for the rare caller that
must not proceed until the record landed — it relays to `/sync` and returns the
documented `200`/`422`/`504`.

## Reads (§4.2)

`POST /queries` takes the same `{action, payload}` envelope, where `payload`
carries `user_id` plus `date` (daily summary) or `month` (the other three).
The action names come from `finance_contracts` (`finance.query.*`) and map to
`domain-api` GETs:

| action | domain-api |
| --- | --- |
| `finance.query.dailySummary` | `GET /finance/daily-summary?user_id=&date=YYYY-MM-DD` |
| `finance.query.monthlyDashboard` | `GET /finance/monthly-dashboard?user_id=&month=YYYY-MM` |
| `finance.query.categoryBreakdown` | `GET /finance/category-breakdown?user_id=&month=YYYY-MM` |
| `finance.query.cashFlowHistory` | `GET /finance/cash-flow-history?user_id=&month=YYYY-MM` |

Unlike the write door there is no `202`/`504` ambiguity: a read either returns
the projection (`200`) or is an error. Money is validated as an exact decimal
**string** on the way out too — a numeric amount in a projection is rejected,
not silently accepted (§3.4-1).

## The part that is easy to get wrong

`504` is **not** a failure. `domain-api` gives up waiting after 10s and
answers `{"status": "queued", "error": "...it stays queued and may still
land"}`. The command may still be applied, so only `written` is a
confirmation — `SyncResult.is_confirmed` encodes exactly that, and the
tests assert the message survives to the caller.

Related: this app never maps `domain-api`'s `401` onto the caller's `401`.
That `401` means *our* key is not in the `domain` stack's `DOMAIN_API_KEYS`
(§10.3), so it is reported as a server-side fault naming the setting.

## Runtime

- env: `DOMAIN_API_BASE_URL`, `DOMAIN_API_KEY`, `HTTP_ADDR`,
  `FINANCE_API_KEYS` (`key:label,...`), `RATE_LIMIT_RPS`/`_BURST`,
  `DOMAIN_API_TIMEOUT_S`, `OTEL_EXPORTER_OTLP_ENDPOINT` (empty = off),
  `OTEL_SERVICE_NAME`.
- forbidden: `DATABASE_URL`, any DB driver, any broker client.
- build context: the **repo root**, so `packages/finance-contracts` is
  reachable. `ENTRYPOINT ["python", "-m", "finance_api.main"]`.

## Tests

```bash
pip install ./packages/finance-contracts
cd modules/apps/finance-api
python -m pytest -q
```

The suite needs no `domain-api`, no Postgres and no broker: the outbound
edge is an `httpx.MockTransport` reproducing the documented contract.
