from __future__ import annotations

from pytest_bdd import given, parsers, scenarios, then, when

from flows.greeting.etl.extract import NameExtractor
from flows.greeting.etl.load import GreetingLoader
from flows.greeting.etl.transform import GreetingTransformer
from flows.greeting.schemas import GreetingInput, GreetingResult, RawName

scenarios("../features/greeting.feature")


@given(parsers.parse('a greeting input with name "{name}"'), target_fixture="payload")
def _given_greeting_input(name: str) -> GreetingInput:
    return GreetingInput(name=name)


@when("the name is extracted", target_fixture="raw_name")
def _when_extracted(payload: GreetingInput) -> RawName:
    return NameExtractor(payload).extract()


@when("the raw name is transformed into a greeting", target_fixture="result")
def _when_transformed(raw_name: RawName) -> GreetingResult:
    return GreetingTransformer().transform(raw_name)


@when("the greeting is loaded")
def _when_loaded(result: GreetingResult) -> None:
    GreetingLoader().load(result)


@then(parsers.parse('the greeting message is "{expected}"'))
def _then_message_is(result: GreetingResult, expected: str) -> None:
    assert result.message == expected


@then(parsers.parse('the extracted name equals "{expected}"'))
def _then_extracted_name_equals(raw_name: RawName, expected: str) -> None:
    assert raw_name.name == expected
