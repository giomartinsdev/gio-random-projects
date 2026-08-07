Feature: Vehicle position events
  As the domain
  I want RecordVehiclePositions to upsert Vehicle/VehiclePosition and append VehiclePositionHistory
  So that current-position tables stay bounded while history captures every poll

  Background:
    Given a domain API backed by a real Postgres database

  Scenario: Recording positions for distinct vehicles creates one row per vehicle in each table
    When positions are recorded for vehicles "B1" and "B2" at "2026-08-05T13:00:00Z"
    Then the response reports 2 positions recorded
    And the vehicle table has rows for "B1" and "B2"
    And the vehicle position table has rows for "B1" and "B2"

  Scenario: Polling the same vehicle again overwrites its row instead of adding one
    Given vehicle "B1" was already recorded at "2026-08-05T13:00:00Z" with latitude -22.9
    When vehicle "B1" is recorded again at "2026-08-05T13:05:00Z" with latitude -23.1
    Then the vehicle table has exactly 1 row
    And the vehicle position table has exactly 1 row
    And vehicle "B1"'s position latitude is -23.1
    And vehicle "B1"'s position was captured at "2026-08-05 13:05:00"

  Scenario: Polling the same vehicle again keeps its original first_seen_at
    Given vehicle "B1" was already recorded at "2026-08-05T13:00:00Z" with latitude -22.9
    When vehicle "B1" is recorded again at "2026-08-05T13:05:00Z" with latitude -22.9
    Then vehicle "B1"'s first_seen_at is unchanged
    And vehicle "B1"'s last_seen_at moved forward

  Scenario: Polling the same vehicle repeatedly appends to history instead of overwriting
    When vehicle "B1" is recorded 3 times at increasing latitudes
    Then the vehicle position history table has 3 rows for "B1"
    But the vehicle position table still has exactly 1 row

  Scenario: Recording an empty list of positions is a no-op
    When an empty list of positions is recorded
    Then the response reports 0 positions recorded
    And the vehicle table has exactly 0 rows

  Scenario: A position missing a required field is rejected
    When a position missing "latitude" is recorded
    Then the response status is 422
    And the vehicle table has exactly 0 rows
