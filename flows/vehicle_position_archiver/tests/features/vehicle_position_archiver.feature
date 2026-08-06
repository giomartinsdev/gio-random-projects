Feature: Vehicle position archiver trigger
  As an operator
  I want the archiver to dispatch the archive event correctly
  So that VehiclePositionHistory stays bounded on schedule

  Scenario: The archiver dispatches the archive event through the gateway
    Given a fake gateway that archives 5 rows
    When the archiver runs
    Then the gateway received the archive event
