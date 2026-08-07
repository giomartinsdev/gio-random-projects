Feature: Domain client
  As bora-api
  I want DomainClient to call the right gateway event and shape its response
  So that the rest of the service never has to know the wire format of a domain event

  Background:
    Given a fake gateway

  Scenario: Listing stops calls list-stops and returns typed records
    Given the gateway returns 2 stops
    When stops are listed
    Then the request hit "list-stops"
    And 2 stop records come back

  Scenario: Listing lines calls list-lines and returns typed records
    Given the gateway returns 1 line
    When lines are listed
    Then the request hit "list-lines"
    And 1 line record comes back

  Scenario: Listing route-stops calls list-route-stops and returns typed records
    Given the gateway returns 3 route-stops
    When route-stops are listed
    Then the request hit "list-route-stops"
    And 3 route-stop records come back

  Scenario: Listing vehicle positions by line passes line_codes as a query param
    Given the gateway returns 1 vehicle position
    When positions are listed for lines "178" and "179"
    Then the request hit "list-vehicle-positions-by-lines"
    And the request's line_codes query param is "178" and "179"

  Scenario: Listing vehicle positions for no lines never calls the gateway
    When positions are listed for no lines
    Then no request was made
    And 0 position records come back

  Scenario: Every request carries the configured API key header
    Given the gateway returns 1 line
    When lines are listed
    Then the request's X-API-Key header is "test-key"
