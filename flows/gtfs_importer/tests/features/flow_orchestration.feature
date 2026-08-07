Feature: GTFS importer Prefect orchestration
  As an operator
  I want the @flow itself to wire extract, transform, and load together
  So that the deployed flow (not just the ETL classes) is proven to run end to end

  Scenario: Running the flow calls extract, transform, and load in order
    Given a fake GtfsExtractor returning 1 well-formed stop
    When the gtfs_importer flow runs
    Then the loader received a capture with 1 stop
