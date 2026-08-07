Feature: Gateway history extractor
  As the vehicle_position_archiver flow
  I want GatewayHistoryExtractor to fetch history rows through the gateway
  So that the archiver has something to plan a prune against

  Scenario: The extractor fetches from the right path with the API key header
    Given a fake gateway with 2 history rows
    When history is extracted
    Then it hit "/events/list-vehicle-position-history" with the API key
    And 2 rows were parsed back, ids in order

  Scenario: A server error propagates rather than being swallowed
    Given a fake gateway that returns a server error
    When history is extracted
    Then the error propagates as an HTTPStatusError with status 500
