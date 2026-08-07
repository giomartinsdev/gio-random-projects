Feature: SPPO poller Prefect orchestration
  As an operator
  I want the @flow itself to wire extract, transform, and load together
  So that the deployed flow (not just the ETL classes) is proven to run end to end

  Scenario: Running the flow calls extract, transform, and load in order
    Given a fake SppoExtractor returning 1 well-formed row
    When the bus_gps_poller flow runs
    Then the loader received exactly 1 position
