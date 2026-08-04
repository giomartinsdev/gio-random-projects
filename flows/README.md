# Flows

## Layout

```
flows/
  shared/                     # base classes every flow's ETL stages inherit from
    logger.py                   # get_logger() + Loggable mixin
    extractor.py                 # class Extractor(Loggable, ABC, Generic[TOut])
    transformer.py                # class Transformer(Loggable, ABC, Generic[TIn, TOut])
    loader.py                     # class Loader(Loggable, ABC, Generic[TIn])
  greeting/                   # one folder per flow, named after the flow (no "etl" suffix)
    schemas.py                  # Pydantic models — every stage's input & output
    etl/
      extract.py                  # class NameExtractor(Extractor[RawName])
      transform.py                  # class GreetingTransformer(Transformer[RawName, GreetingResult])
      load.py                        # class GreetingLoader(Loader[GreetingResult])
    flow.py                     # @flow + thin @task wrappers orchestrating E → T → L
    tests/                      # this flow's tests — Gherkin + GWT unit tests
      features/
        greeting.feature
      steps/
        test_greeting_steps.py
      unit/
        test_extract.py
        test_transform.py
        test_load.py
  requirements.txt
```

`greeting/` is the reference implementation — copy its shape for a new flow.

## Pattern

1. **Every ETL stage is a class**, one class per file, inheriting from
   `Extractor[T]` / `Transformer[TIn, TOut]` / `Loader[T]` in `flows/shared/`.
   Generic type parameters make the contract explicit — mypy catches a
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

5. **Tests live inside the flow's own folder** (`greeting/tests/`), not a
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
def my_flow(payload: MyInput) -> MyResult:
    ...
```

Then add it to `prefect.yaml`'s `deployments:` list, with
`work_pool.job_variables.networks: ["prefect-net"]`. Push to `main` — CI
deploys it automatically (`.github/workflows/prefect-deploy.yml`).

## Running checks locally

```
pip install -r requirements-dev.txt
mypy flows
pytest flows -v
```

Both run in CI on every push touching `flows/**`
(`.github/workflows/flows-ci.yml`) — untyped defs and failing
scenarios/tests fail the build.
