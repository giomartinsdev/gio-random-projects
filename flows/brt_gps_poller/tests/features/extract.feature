Feature: BRT extractor
  As the brt_gps_poller flow
  I want BrtExtractor to fetch the live BRT snapshot and degrade gracefully
  So that a malformed upstream response never crashes the poll

  Background:
    Given a fake BRT endpoint

  Scenario: The extractor requests the BRT endpoint with no query params
    When BRT positions are extracted
    Then the request hit "https://dados.mobilidade.rio/gps/brt" with no query string

  Scenario: The extractor returns the veiculos array untouched
    Given the endpoint returns 2 raw vehicle rows
    When BRT positions are extracted
    Then both raw rows come back untouched

  Scenario: The extractor returns nothing when the envelope has no veiculos key
    Given the endpoint returns an empty JSON object
    When BRT positions are extracted
    Then an empty list comes back

  Scenario: The extractor returns nothing when the response isn't a JSON object
    Given the endpoint returns a JSON array instead of an object
    When BRT positions are extracted
    Then an empty list comes back
