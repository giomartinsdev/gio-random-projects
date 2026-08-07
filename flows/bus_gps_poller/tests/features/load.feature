Feature: SPPO gateway loader
  As the bus_gps_poller flow
  I want GatewayBusPositionLoader to post the whole batch as one request
  So that one poll produces one domain_event_store audit row, not one per vehicle

  Scenario: The whole batch is posted as one request with the API key header
    Given 2 captures for vehicles "B1" and "B2"
    When the batch is loaded
    Then exactly 1 request was made to "/events/record-vehicle-positions"
    And the request carried the API key
    And the request body contains both vehicle ids

  Scenario: Loading an empty batch makes no request at all
    Given no captures
    When the batch is loaded
    Then no request was made
