Feature: Reference data cache
  As bora-api
  I want ReferenceDataCache to hold Stop/Line/RouteStop in memory and refresh on a TTL
  So that Stop/Line/RouteStop reads never round-trip to the domain on every request

  Background:
    Given a fake domain client

  Scenario: The first read fetches from the domain
    Given the domain has 2 stops
    When stops are read from the cache
    Then the domain client was called 1 time
    And 2 stops come back

  Scenario: A second read within the TTL reuses the cached data
    Given the domain has 2 stops
    And stops were already read from the cache
    When stops are read from the cache again
    Then the domain client was called 1 time

  Scenario: A read after the TTL expires refreshes from the domain
    Given the domain has 2 stops
    And stops were already read from the cache
    And the TTL has expired
    When stops are read from the cache again
    Then the domain client was called 2 times

  Scenario: route_stops_at_stop indexes route-stops by stop id
    Given the domain has route-stops "S1" and "S2" for line "178"
    When route-stops at stop "S1" are read from the cache
    Then 1 route-stop comes back for stop "S1"

  Scenario: route_stops_at_stop returns nothing for a stop with no service
    Given the domain has route-stops "S1" and "S2" for line "178"
    When route-stops at stop "S9" are read from the cache
    Then 0 route-stops come back for stop "S9"

  Scenario: line looks up a cached line by id
    Given the domain has 1 line with id "L0"
    When line "L0" is read from the cache
    Then the line comes back

  Scenario: line returns nothing for an unknown id
    Given the domain has 1 line with id "L0"
    When line "L9" is read from the cache
    Then nothing comes back
