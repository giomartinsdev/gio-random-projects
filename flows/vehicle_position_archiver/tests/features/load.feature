Feature: Gateway archive loader
  As the vehicle_position_archiver flow
  I want GatewayArchiveLoader to upload the Parquet file then delete the archived rows
  So that VehiclePositionHistory only loses rows once they're safely in MinIO

  Scenario: Loading an empty plan skips the gateway entirely
    Given an empty archive plan
    When the plan is loaded
    Then no request was made

  Scenario: A real plan creates the bucket, uploads the object, then deletes the rows
    Given an archive plan with 2 archived ids and object key "vehicle-position-history/2026/08/06/000000-abcd1234.parquet"
    When the plan is loaded
    Then the requests happened in order: create-bucket, put-object, delete-vehicle-position-history-batch
    And the create-bucket request named the archive bucket
    And the put-object request carried the object key and the parquet bytes
    And the delete request named exactly ids "10" and "11"

  Scenario: A very large delete batch is chunked into multiple requests
    Given an archive plan with 501 archived ids
    When the plan is loaded
    Then the delete happened in 2 requests, not one oversized one

  Scenario: A 429 during loading is retried after Retry-After instead of crashing
    Given a gateway that rate-limits the first create-bucket attempt for 3 seconds
    When the plan is loaded
    Then it slept for 3.0 seconds
    And create-bucket was attempted 2 times

  Scenario: Loading gives up after repeated 429s instead of retrying forever
    Given a gateway that always rate-limits every request
    When the plan is loaded
    Then the error propagates as an HTTPStatusError with status 429
