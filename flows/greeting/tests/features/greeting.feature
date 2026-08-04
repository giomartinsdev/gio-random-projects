Feature: Greeting ETL
  As an operator
  I want the greeting flow's Extract, Transform, and Load stages to behave correctly
  So that the flow produces the right message end to end

  Scenario: Building a greeting from a valid name
    Given a greeting input with name "gio"
    When the name is extracted
    And the raw name is transformed into a greeting
    Then the greeting message is "Hello, gio!"

  Scenario: Extraction preserves the exact name from the input
    Given a greeting input with name "Ada"
    When the name is extracted
    Then the extracted name equals "Ada"

  Scenario: Loading a greeting does not raise
    Given a greeting input with name "Grace"
    When the name is extracted
    And the raw name is transformed into a greeting
    And the greeting is loaded
    Then the greeting message is "Hello, Grace!"
