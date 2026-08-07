Feature: Vehicle position archiver Prefect orchestration
  As an operator
  I want the @flow itself to wire extract, transform, and load together
  So that the deployed flow (not just the ETL classes) is proven to run end to end

  Scenario: Running the flow calls extract, transform, and load in order
    Given a fake GatewayHistoryExtractor returning 12 history rows for one vehicle
    When the vehicle_position_archiver flow runs with keep_per_vehicle 10
    Then the loader received a plan archiving exactly 2 rows
