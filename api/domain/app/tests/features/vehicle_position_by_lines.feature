Feature: Listing vehicle positions by line
  As the domain
  I want ListVehiclePositionsByLines to return only the requested lines' current positions
  So that a caller with a handful of lines to check never has to pull every vehicle city-wide

  Background:
    Given a domain API backed by a real Postgres database
    And vehicle "B1" on line "178" was recorded at "2026-08-06T13:00:00Z"
    And vehicle "B2" on line "179" was recorded at "2026-08-06T13:00:00Z"

  Scenario: Listing by one line returns only that line's vehicles
    When positions are listed for line "178"
    Then the listed vehicle ids are "B1"

  Scenario: Listing by multiple lines returns the union
    When positions are listed for lines "178" and "179"
    Then the listed vehicle ids are "B1" and "B2"

  Scenario: Listing an empty set of lines returns nothing
    When positions are listed for no lines
    Then 0 positions come back
