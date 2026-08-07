Feature: Line events
  As the domain
  I want UpsertLines to upsert Line rows and ListLines to return every line
  So that a GTFS reimport never duplicates a line it already knows about

  Background:
    Given a domain API backed by a real Postgres database

  Scenario: Upserting distinct lines creates one row per line
    When lines "178" and "179" are upserted
    Then the response reports 2 lines upserted
    And the line table has rows for "178" and "179"

  Scenario: Upserting the same line again overwrites its row instead of adding one
    Given line "178" was already upserted with mode "bus"
    When line "178" is upserted again with mode "brt"
    Then the line table has exactly 1 row
    And line "178"'s mode is "brt"

  Scenario: Upserting an empty list of lines is a no-op
    When an empty list of lines is upserted
    Then the response reports 0 lines upserted
    And the line table has exactly 0 rows

  Scenario: Listing lines returns every upserted line
    Given line "178" was already upserted with mode "bus"
    And line "179" was already upserted with mode "bus"
    When every line is listed
    Then the listed lines are "178" and "179"
