Feature: GTFS transformer
  As the gtfs_importer flow
  I want GtfsTransformer to shape raw GTFS rows into Stop/Line/RouteStop payloads
  So that malformed upstream rows never crash the import and BRT lines are tagged correctly

  Scenario: Stops and routes are parsed into typed captures
    Given 1 stop row and 1 regular bus route row
    When the raw tables are transformed
    Then 1 stop capture and 1 line capture come back
    And the line's mode is "bus"

  Scenario: A route id prefixed with BRT is tagged as brt mode
    Given 1 route row with id "BRT01"
    When the raw tables are transformed
    Then the line's mode is "brt"

  Scenario: A malformed stop row is skipped instead of failing the whole import
    Given 1 stop row missing "stop_lat"
    And 1 well-formed stop row
    When the raw tables are transformed
    Then 1 stop capture comes back

  Scenario: The trip with the most stop_times wins as a line's representative pattern
    Given route "178" has trip "short" with 2 stops
    And route "178" has trip "long" with 3 stops
    When the raw tables are transformed
    Then line "178"'s route-stops come from the "long" trip's 3 stops in sequence order
