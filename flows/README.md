# Flows

## Layout

```
flows/
  shared/                     # base classes every flow's ETL stages inherit from
    logger.py                   # get_logger() + Loggable mixin
    extractor.py                 # class Extractor(Loggable, ABC, Generic[TOut])
    transformer.py                # class Transformer(Loggable, ABC, Generic[TIn, TOut])
    loader.py                     # class Loader(Loggable, ABC, Generic[TIn])
  bus_gps_poller/             # one folder per flow, named after the flow (no "etl" suffix)
    schemas.py                  # Pydantic models — every stage's input & output
    etl/
      extract.py                  # class SppoExtractor(Extractor[list[dict[str, Any]]])
      transform.py                  # class BusPositionTransformer(Transformer[list[dict], list[BusPositionCapture]])
      load.py                        # class GatewayBusPositionLoader(Loader[list[BusPositionCapture]])
    flow.py                     # @flow + thin @task wrappers orchestrating E → T → L
    tests/                      # this flow's tests — Gherkin + GWT unit tests
      features/
        bus_gps_poller.feature
      steps/
        test_bus_gps_poller_steps.py
      unit/
        test_extract.py
        test_transform.py
        test_load.py
  requirements.txt
```

`bus_gps_poller/` is the reference implementation — copy its shape for a new flow.

## Pattern

1. **Every ETL stage is a class**, one class per file, inheriting from
   `Extractor[T]` / `Transformer[TIn, TOut]` / `Loader[T]` in `flows/shared/`.
   Generic type parameters make the contract explicit — pyright catches a
   `Transformer` wired to the wrong `Extractor`'s output at the point
   they're assembled in `flow.py`, not at runtime.

2. **The classes are Prefect-agnostic.** No `@task`, no `prefect` import in
   `etl/extract.py` / `etl/transform.py` / `etl/load.py` — that's what
   makes them unit-testable with plain pytest, no Prefect runtime needed.
   `flow.py` wraps each one in a thin `@task` function so every stage
   still shows up as its own task run in the UI (retries, caching,
   per-stage logs).

3. **Every input/output is a Pydantic model from that flow's `schemas.py`.**
   No bare `dict`. A bad input fails at the flow boundary with a clear
   Pydantic error, not three stages deep with a `KeyError`.

4. **Logging is standard across every class** — `flows/shared/logger.py`'s
   `Loggable` mixin gives every `Extractor`/`Transformer`/`Loader` instance
   a `self.logger` with the same format, no per-flow setup needed.

5. **Tests live inside the flow's own folder** (`bus_gps_poller/tests/`), not a
   top-level `tests/` dir — they're that flow's tests, nothing else's.
   - `tests/features/*.feature` — Gherkin scenarios (Given/When/Then),
     one feature file describing the flow's behavior end to end.
   - `tests/steps/test_*_steps.py` — pytest-bdd step definitions wiring
     the Gherkin steps to the actual classes.
   - `tests/unit/test_*.py` — plain pytest, one file per ETL class, each
     test with an explicit `# Given / # When / # Then` comment structure.

## Adding a new flow

```
flows/my_flow/
  __init__.py
  schemas.py
  etl/
    __init__.py
    extract.py
    transform.py
    load.py
  flow.py
  tests/
    features/my_flow.feature
    steps/test_my_flow_steps.py
    unit/test_extract.py
    unit/test_transform.py
    unit/test_load.py
```

```python
# flows/my_flow/schemas.py
class MyInput(BaseModel): ...


class MyResult(BaseModel): ...
```

```python
# flows/my_flow/etl/extract.py
from flows.shared.extractor import Extractor
from flows.my_flow.schemas import MyInput, MyRaw


class MyExtractor(Extractor[MyRaw]):
    def __init__(self, payload: MyInput) -> None:
        super().__init__()
        self._payload = payload

    def extract(self) -> MyRaw: ...
```

```python
# flows/my_flow/flow.py
from prefect import flow, task
from flows.my_flow.etl.extract import MyExtractor
from flows.my_flow.schemas import MyInput, MyResult


@task
def extract(payload: MyInput) -> MyRaw:
    return MyExtractor(payload).extract()


@flow(log_prints=True)
def my_flow(payload: MyInput) -> MyResult: ...
```

Then add it to `prefect.yaml`'s `deployments:` list, with
`work_pool.job_variables.networks: ["prefect-net"]`. Push to `main` — CI
deploys it automatically (`.github/workflows/flows-ci.yml`'s `deploy`
job). The same job also prunes any deployment whose entry gets removed
from `prefect.yaml` later (`.github/scripts/prune_prefect_deployments.py`)
— `prefect deploy --all` alone only ever creates/updates, never deletes.

### Business rules live in the flow, not the domain: `vehicle_position_archiver/`

The domain API (`api/domain`) is deliberately kept to CRUD/storage
mechanics only — no embedded policy about *when* or *what* to prune,
archive, or otherwise decide. `vehicle_position_archiver/` is the
clearest example: it owns the actual rule ("keep only the 10 most
recent VehiclePositionHistory rows per vehicle") end to end —

- `etl/extract.py` — `GatewayHistoryExtractor` pulls every history row
  via the domain's `ListVehiclePositionHistory` event (a plain, opinion-free
  `GET`).
- `etl/transform.py` — `ArchivePlanner` does the actual ranking (group by
  vehicle, keep the newest N, everything else is "to archive") and
  builds the Parquet bytes in memory — logic that used to be a
  `ROW_NUMBER() OVER (...)` query inside the domain itself.
- `etl/load.py` — `GatewayArchiveLoader` uploads that Parquet file via
  the domain's generic `object_storage` events (`CreateBucket`,
  `PutObject`), then deletes the archived rows via
  `DeleteVehiclePositionHistoryBatch` — again, generic "delete these
  ids" with no policy baked in.

The domain only ever sees "list everything" and "delete these specific
ids" — it has no idea *why*. See
`api/domain/app/domain/vehicle_position/history_events.py`'s module
docstring for the reasoning, and apply the same split for any future
domain: if an event's `handle()` is making a decision rather than just
persisting or fetching what it's told to, that decision belongs in a
flow instead.

## Tracing

Every flow/task run is automatically traced *and* logged to the
observability stack (`observability.giomartins.dev`) — Tempo and Loki,
browseable in Grafana. **No code changes needed per flow**: Prefect
generates the spans itself and stdlib `logging` (what `get_run_logger()`
uses) is what ships to Loki; the deployment's `job_variables` in
`prefect.yaml` just need to be copied onto each new deployment for the
export to actually happen:

```yaml
work_pool:
  name: docker-pool
  job_variables:
    networks: ["prefect-net"]
    command: "opentelemetry-instrument prefect flow-run execute"
    env:
      OTEL_SERVICE_NAME: <flow-name>   # change per deployment
      OTEL_TRACES_EXPORTER: otlp
      OTEL_LOGS_EXPORTER: otlp
      OTEL_PYTHON_LOG_CORRELATION: "true"
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_EXPORTER_OTLP_ENDPOINT: https://otel.giomartins.dev
      OTEL_EXPORTER_OTLP_HEADERS: "CF-Access-Client-Id={{ prefect.blocks.secret.cf-acess-client-id }},CF-Access-Client-Secret={{ prefect.blocks.secret.cf-acess-client-secret }}"
      OTEL_BSP_SCHEDULE_DELAY: "100"
      OTEL_BLRP_SCHEDULE_DELAY: "100"
```

Why each piece is there (found by testing, not guessing):
- `command` swaps the container's default `prefect flow-run execute` for
  the same thing wrapped in `opentelemetry-instrument` — installing the
  OTel packages alone does **not** export anything; the wrapper is what
  actually activates Prefect's built-in span generation.
- The `run_shell_script: opentelemetry-bootstrap -a install` pull step
  (already in `prefect.yaml`) auto-detects and installs the right
  instrumentor for whatever a flow imports (`requests`, `httpx`,
  `sqlalchemy`, ...) — this is what makes it agnostic per flow; nothing
  to declare.
- `OTEL_LOGS_EXPORTER: otlp` turns on the same wrapper's logging
  instrumentor — without it, `OTEL_TRACES_EXPORTER` alone only ships
  spans, nothing shows up in Loki.
- `OTEL_PYTHON_LOG_CORRELATION: "true"` stamps `trace_id`/`span_id` onto
  every log record emitted while a span is active, so a log line in Loki
  can be matched back to its span in Tempo instead of correlating by eye
  on timestamps.
- `OTEL_EXPORTER_OTLP_ENDPOINT` goes out over the public tunnel (not the
  internal `prefect-net` network) because the observability stack is a
  separate Arcane deployment on its own Docker network — same reasoning
  as CI authenticating through Cloudflare Access, and why the headers
  reference the `cf-acess-client-id` / `cf-acess-client-secret` **Secret
  blocks** (Blocks tab in the Prefect UI) instead of a plaintext value.
- `OTEL_BSP_SCHEDULE_DELAY` / `OTEL_BLRP_SCHEDULE_DELAY` — the default 5s
  batch-export interval (spans and logs each have their own batch
  processor) loses data on a flow that finishes in under 5 seconds (the
  container exits before the batch flushes). Confirmed by testing: about
  half the runs silently dropped their trace without the span-processor
  one; the log-record-processor one is the same fix for logs.

A pre-built "Prefect Flow Overview" dashboard (traces, request/error rate,
p95 latency, and logs, filterable by `OTEL_SERVICE_NAME`) lives at
`infra/grafana-dashboards/prefect-flow-overview.json` — drop it in the
observability stack's `grafana-dashboards` MinIO bucket, or import it
directly in Grafana (Dashboards → New → Import → paste JSON).

## Running checks locally

```
pip install -r requirements-dev.txt
ruff check flows
ruff format --check flows
pyright flows
pytest flows -v
```

All four run in CI on every push touching `flows/**`
(`.github/workflows/flows-ci.yml`) — lint violations, untyped defs, and
failing scenarios/tests fail the build. Prefect deployment only runs
(`deploy` job) once all three pass, so a broken flow never gets
deployed.
