Feature: SPPO extractor
  As the bus_gps_poller flow
  I want SppoExtractor to fetch the current window from the SPPO endpoint and degrade gracefully
  So that a malformed upstream response never crashes the poll

  Background:
    Given a fake SPPO endpoint

  Scenario: The extractor requests the SPPO endpoint with a hand-built date window
    When SPPO positions are extracted with a 300 second window
    Then exactly 1 request was made
    And the request URL has a dataInicial and dataFinal window with unencoded "+" separators

  Scenario: The extractor returns the parsed JSON rows untouched
    Given the endpoint returns 2 raw vehicle rows
    When SPPO positions are extracted with a 300 second window
    Then both raw rows come back untouched

  Scenario: The extractor returns nothing when the response isn't a JSON array
    Given the endpoint returns an empty JSON object
    When SPPO positions are extracted with a 300 second window
    Then an empty list comes back
