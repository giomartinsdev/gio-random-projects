from __future__ import annotations

from flows.greeting_etl.schemas import RawName
from flows.greeting_etl.transform import GreetingTransformer


def test_transformer_builds_a_hello_message() -> None:
    # Given a raw name
    raw = RawName(name="Ada")
    transformer = GreetingTransformer()

    # When transform is called
    result = transformer.transform(raw)

    # Then the message greets that exact name
    assert result.name == "Ada"
    assert result.message == "Hello, Ada!"
