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
| `POST /commands` | The default write door. Validates and relays; reports the relayed outcome (`200 written` / `422 failed` / `504 queued`). |
| `POST /commands/sync` | Same envelope, explicitly blocking path. Same outcome shape. |

All three write routes need `X-API-Key`; the key's **label** names the
caller in the audit trail (§12.3). Read routes (§4.2) are the next slice.

## Why `/commands` does not answer a bare `202` yet

The spec's default is asynchronous (`202`) because the WhatsApp worker
replies to the user asynchronously. `domain-api`, however, has **no
asynchronous door that accepts the `{action, payload}` envelope**: every
`202` route in its `router.go` takes a route-specific payload
(`UpsertClubInput`, …), and `POST /sync` is the only handler that decodes
the envelope. So the only relay that can work today is the blocking one, and
this service refuses to answer a `202` nothing upstream accepted.

The guard lives in one place — `CommandRouter(supports_async=...)` — and two
tests pin it: one asserts the refusal today, one asserts the async relay
works the moment the capability is declared. When slice 2 adds the door,
flip the flag and update the pair.

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
