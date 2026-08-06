Feature: Vehicle position archiver trigger
  As an operator
  I want the archiver to dispatch the archive event correctly
  So that VehiclePositionHistory stays bounded on schedule

  Scenario: Archiving reports how many rows were archived
    Given a fake gateway that archives 5 rows
    When the archiver runs
    Then it reports 5 rows archived
