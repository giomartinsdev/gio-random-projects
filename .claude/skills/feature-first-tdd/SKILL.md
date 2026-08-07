---
name: feature-first-tdd
description: Use this BEFORE writing or changing any implementation code in this repo (api/domain, api/gateway, or flows/*) — new endpoints, new domain events, new ETL steps, bug fixes, refactors, anything. Enforces writing failing .feature (Gherkin, Given/When/Then) integration tests backed by real testcontainers FIRST, covering positive, negative, and edge cases, before touching implementation. Also load it when the user asks to add tests, fix a bug, or add a feature to this codebase.
---

# Feature-first TDD with testcontainers

This repo's tests are integration tests, not unit tests. Every service (`api/domain`,
`api/gateway`, each flow under `flows/`) is tested by:

1. A **`.feature` file** (Gherkin, Given/When/Then) under `<service>/.../tests/features/`
2. A matching **steps file** under `<service>/.../tests/steps/test_*_steps.py`, using
   `pytest-bdd` (`@given`/`@when`/`@then` + `scenarios(...)`)
3. Real infrastructure via **testcontainers** wherever the code under test talks to a
   real dependency — Postgres for `api/domain`, MinIO for object storage, a real upstream
   HTTP server in its own container for `api/gateway`. No mocked ORMs, no fake S3
   clients standing in for a real one, no in-process ASGI transports pretending to be a
   network hop when a real one is what's actually being tested.

There is no `unit/` test tier here. If a fresh testable unit truly has no real
infrastructure boundary to containerize (pure functions, e.g. a header-formatting
helper), it's still written as GWT with pytest-bdd, and the `.feature` file says so with
a short comment — see `api/domain/app/tests/features/object_storage_infrastructure.feature`
for a real example of that exception.

## The rule: tests before implementation

Whenever you are about to write or modify implementation code in this repo:

1. **Stop before touching the implementation.** Write or extend the relevant
   `.feature` file first — describe the behavior in Given/When/Then, in plain language,
   before any code exists to satisfy it.
2. **Cover three kinds of scenario, not just the happy path:**
   - **Positive** — the normal, expected case succeeds.
   - **Negative** — invalid input, missing auth, a downstream failure — is rejected or
     handled the way the system is supposed to handle it (right status code, no
     partial writes, no silent swallow).
   - **Edge** — empty input, boundary counts (0, 1, exactly-the-limit,
     one-over-the-limit), idempotency (doing the same thing twice), nonexistent
     ids/keys.
3. **Write the steps file** implementing those scenarios against the real
   dependency (see the testcontainers fixtures already set up in each service's
   `tests/conftest.py` — reuse them, don't hand-roll a new fake).
4. **Run the suite and watch it fail** for the right reason (missing implementation),
   not an unrelated error.
5. **Only then** write or change the implementation, iterating until the scenarios pass.
6. **Check coverage.** Each service's `pyproject.toml` enforces `--cov-fail-under=90`.
   If your change drops a service under 90%, that's a signal a scenario is missing —
   add it, don't lower the threshold.

## If asked to skip this

If the user explicitly says to skip writing tests first for a specific change, say so
back in one line ("skipping test-first for this one, per your instruction") and proceed
— don't silently comply or refuse. This rule governs your default behavior, not a hard
gate against the user's own explicit call.

## Reference examples in this repo

- `api/domain/app/tests/features/vehicle_position_events.feature` +
  `.../steps/test_vehicle_position_events_steps.py` — real Postgres via testcontainers,
  positive/negative/edge all present (empty list, missing field → 422, upsert vs.
  append semantics).
- `api/domain/app/tests/features/object_storage_events.feature` — real MinIO via
  testcontainers, including a negative scenario (`put-object` into a bucket that
  doesn't exist fails loudly rather than being swallowed).
- `api/gateway/app/tests/features/proxy.feature` — a real upstream HTTP server running
  in its own container (`api/gateway/app/tests/fixtures/upstream_server.py`), not an
  in-process ASGI transport, so proxy.py's real network behavior is what's tested.
- `flows/vehicle_position_archiver/tests/features/load.feature` — retry-after-429 and
  chunking-a-large-batch as explicit edge scenarios, not just the straight-line case.
