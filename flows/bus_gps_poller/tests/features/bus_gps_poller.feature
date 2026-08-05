Feature: Bus GPS poll cycle
  As an operator
  I want each poll to extract, parse, and load bus positions end to end
  So that a full 5-minute poll can be trusted to work in production

  Scenario: A full poll cycle loads every well-formed position
    Given a fake SPPO endpoint returning 2 well-formed rows and 1 malformed row
    When a poll cycle runs
    Then the gateway received exactly 2 positions
    And the malformed row was skipped without failing the poll

  Scenario: An empty SPPO response loads nothing
    Given a fake SPPO endpoint returning no rows
    When a poll cycle runs
    Then the gateway was never called
