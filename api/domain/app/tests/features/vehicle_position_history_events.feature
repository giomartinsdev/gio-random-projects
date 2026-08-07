Feature: Vehicle position history events
  As the domain
  I want ListVehiclePositionHistory/DeleteVehiclePositionHistoryBatch to do exactly
  what they say and nothing more
  So that pruning policy stays entirely owned by flows/vehicle_position_archiver

  Background:
    Given a domain API backed by a real Postgres database

  Scenario: Listing history returns every row unfiltered
    Given vehicle "B1" was polled 12 times
    When the vehicle position history is listed
    Then 12 rows come back

  Scenario: Deleting a batch removes exactly the given ids
    Given vehicle "B1" was polled 3 times
    When the first 2 history ids are deleted as a batch
    Then the response reports 2 rows deleted
    And exactly 1 history row remains

  Scenario: Deleting an empty batch is a no-op
    Given vehicle "B1" was polled 1 time
    When an empty batch of history ids is deleted
    Then the response reports 0 rows deleted
    And exactly 1 history row remains

  Scenario: Deleting ids that don't exist deletes nothing and doesn't error
    Given vehicle "B1" was polled 1 time
    When a batch of nonexistent history ids is deleted
    Then the response reports 0 rows deleted
    And exactly 1 history row remains

  Scenario: Listing history when nothing has been recorded returns nothing
    When the vehicle position history is listed
    Then 0 rows come back
