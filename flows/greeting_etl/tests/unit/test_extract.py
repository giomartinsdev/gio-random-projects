from __future__ import annotations

from flows.greeting_etl.extract import NameExtractor
from flows.greeting_etl.schemas import GreetingInput


def test_extractor_returns_the_input_name() -> None:
    # Given a greeting input with a specific name
    payload = GreetingInput(name="gio")
    extractor = NameExtractor(payload)

    # When extract is called
    result = extractor.extract()

    # Then the raw name matches the input exactly
    assert result.name == "gio"
