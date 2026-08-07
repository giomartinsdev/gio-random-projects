Feature: Stop events
  As the domain
  I want UpsertStops to upsert Stop rows and ListStops to return every stop
  So that a GTFS reimport never duplicates a stop it already knows about

  Background:
    Given a domain API backed by a real Postgres database

  Scenario: Upserting distinct stops creates one row per stop
    When stops "S1" and "S2" are upserted
    Then the response reports 2 stops upserted
    And the stop table has rows for "S1" and "S2"

  Scenario: Upserting the same stop again overwrites its row instead of adding one
    Given stop "S1" was already upserted with name "Rua A"
    When stop "S1" is upserted again with name "Rua A Reformada"
    Then the stop table has exactly 1 row
    And stop "S1"'s name is "Rua A Reformada"

  Scenario: Upserting an empty list of stops is a no-op
    When an empty list of stops is upserted
    Then the response reports 0 stops upserted
    And the stop table has exactly 0 rows

  Scenario: Listing stops returns every upserted stop
    Given stop "S1" was already upserted with name "Rua A"
    And stop "S2" was already upserted with name "Rua B"
    When every stop is listed
    Then the listed stops are "S1" and "S2"
