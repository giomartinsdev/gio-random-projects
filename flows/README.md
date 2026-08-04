# Flows

## Layout

```
flows/
  base.py                  # shared Extractor / Transformer / Loader base classes + logging
  greeting_etl/             # one folder per flow
    schemas.py               # Pydantic models — every stage's input & output
    extract.py                # class NameExtractor(Extractor[RawName])
    transform.py               # class GreetingTransformer(Transformer[RawName, GreetingResult])
    load.py                    # class GreetingLoader(Loader[GreetingResult])
    flow.py                    # @flow + thin @task wrappers orchestrating E → T → L
    tests/                     # this flow's tests — Gherkin + GWT unit tests
      features/
        greeting_etl.feature
      steps/
        test_greeting_etl_steps.py
      unit/
        test_extract.py
        test_transform.py
        test_load.py
  requirements.txt
```

`greeting_etl/` is the reference implementation — copy its shape for a new flow.

## Pattern

1. **Every ETL stage is a class**, inheriting from `Extractor[T]`,
   `Transformer[TIn, TOut]`, or `Loader[T]` in `flows/base.py`. Generic type
   parameters make the contract explicit — mypy catches a `Transformer`
   wired to the wrong `Extractor`'s output at the point they're assembled
   in `flow.py`, not at runtime.

2. **The classes are Prefect-agnostic.** No `@task`, no `prefect` import in
   `extract.py`/`transform.py`/`load.py` — that's what makes them
   unit-testable with plain pytest, no Prefect runtime needed. `flow.py`
   wraps each one in a thin `@task` function so every stage still shows up
   as its own task run in the UI (retries, caching, per-stage logs).

3. **Every input/output is a Pydantic model from that flow's `schemas.py`.**
   No bare `dict`. A bad input fails at the flow boundary with a clear
   Pydantic error, not three stages deep with a `KeyError`.

4. **Logging is standard across every class** — `flows/base.py`'s
   `get_logger()` gives every `Extractor`/`Transformer`/`Loader` instance a
   `self.logger` with the same format, no per-flow setup needed.

5. **Tests live inside the flow's own folder** (`tests/`), not a top-level
   `tests/` dir — they're that flow's tests, nothing else's.
   - `tests/features/*.feature` — Gherkin scenarios (Given/When/Then),
     one feature file describing the flow's behavior end to end.
   - `tests/steps/test_*_steps.py` — pytest-bdd step definitions wiring
     the Gherkin steps to the actual classes.
   - `tests/unit/test_*.py` — plain pytest, one file per ETL class, each
     test with an explicit `# Given / # When / # Then` comment structure.

## Adding a new flow

```
flows/my_new_flow/
  __init__.py
  schemas.py
  extract.py
  transform.py
  load.py
  flow.py
  tests/
    features/my_new_flow.feature
    steps/test_my_new_flow_steps.py
    unit/test_extract.py
    unit/test_transform.py
    unit/test_load.py
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
