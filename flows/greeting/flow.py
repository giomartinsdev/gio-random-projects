"""Orchestration only. Prefect's @task wraps each ETL class call so every
stage shows up as its own task run in the UI (retries, caching, logs) —
the classes themselves stay Prefect-agnostic and unit-testable on their own.
"""

from __future__ import annotations

from prefect import flow, task

from flows.greeting.etl.extract import NameExtractor
from flows.greeting.etl.load import GreetingLoader
from flows.greeting.etl.transform import GreetingTransformer
from flows.greeting.schemas import GreetingInput, GreetingResult, RawName


@task
def extract(payload: GreetingInput) -> RawName:
    return NameExtractor(payload).extract()


@task
def transform(data: RawName) -> GreetingResult:
    return GreetingTransformer().transform(data)


@task
def load(data: GreetingResult) -> None:
    GreetingLoader().load(data)


@flow(log_prints=True)
def greeting(payload: GreetingInput | None = None) -> GreetingResult:
    payload = payload or GreetingInput(name="gio")
    raw = extract(payload)
    result = transform(raw)
    load(result)
    return result


if __name__ == "__main__":
    greeting()
