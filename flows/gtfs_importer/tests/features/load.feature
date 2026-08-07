Feature: GTFS gateway loader
  As the gtfs_importer flow
  I want GatewayGtfsLoader to post stops, lines, and route-stops to the gateway
  So that the domain's Stop/Line/RouteStop tables reflect one GTFS import

  Background:
    Given a fake gateway

  Scenario: Loading a capture posts three events in order
    Given a capture with 1 stop, 1 line, and 1 route-stop
    When the capture is loaded
    Then exactly 3 requests were made
    And the requests were, in order, "upsert-stops", "upsert-lines", "replace-route-stops"

  Scenario: Replace-route-stops includes every line id from the capture, not just ones with stops
    Given a capture with lines "178" and "179" but route-stops only for "178"
    When the capture is loaded
    Then the replace-route-stops request's line_ids are "178" and "179"
