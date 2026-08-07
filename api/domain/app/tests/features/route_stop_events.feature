Feature: RouteStop events
  As the domain
  I want ReplaceRouteStops to replace a line's stop sequence and ListRouteStopsByLine to return it
  So that a GTFS reimport's stop-sequence changes never leave stale rows behind

  Background:
    Given a domain API backed by a real Postgres database
    And stops "S1", "S2", and "S3" exist
    And lines "178" and "179" exist

  Scenario: Replacing a line's stops for the first time inserts them
    When line "178"'s stops are replaced with "S1" then "S2"
    Then the response reports 2 route-stops replaced
    And line "178"'s stop sequence is "S1" then "S2"

  Scenario: Replacing a line's stops again removes the old sequence instead of appending to it
    Given line "178"'s stops were already replaced with "S1" then "S2"
    When line "178"'s stops are replaced with "S3"
    Then line "178"'s stop sequence is "S3"

  Scenario: Replacing one line's stops never touches another line's sequence
    Given line "178"'s stops were already replaced with "S1" then "S2"
    When line "179"'s stops are replaced with "S3"
    Then line "178"'s stop sequence is "S1" then "S2"
    And line "179"'s stop sequence is "S3"

  Scenario: Replacing with an empty stop list clears the line's sequence
    Given line "178"'s stops were already replaced with "S1" then "S2"
    When line "178"'s stops are replaced with nothing
    Then line "178"'s stop sequence is empty

  Scenario: Listing every route-stop returns rows across every line
    Given line "178"'s stops were already replaced with "S1" then "S2"
    And line "179"'s stops were already replaced with "S3" then "S1"
    When every route-stop is listed
    Then 4 route-stop rows come back

  Scenario: Replacing more stops than fit in a single bulk insert still works
    When line "178"'s stops are replaced with 20000 generated stops
    Then the response reports 20000 route-stops replaced
