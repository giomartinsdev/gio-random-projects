Feature: bora-api HTTP wiring
  As an operator
  I want main.py's routes to call the trip planner/geocoder and shape their output as JSON
  So that the deployed service (not just the underlying classes) is proven to work end to end

  Background:
    Given a bora-api test client with fake dependencies

  Scenario: The health check responds ok
    When GET /health is requested
    Then the response status is 200
    And the response body is {"status": "ok"}

  Scenario: Nearby stops are returned as JSON
    Given the fake planner returns 1 nearby stop
    When GET /nearby-stops is requested with lat -22.9 and lon -43.2
    Then the response status is 200
    And the response has 1 nearby stop

  Scenario: Trip options are returned as JSON
    Given the fake planner returns 1 trip option
    When GET /trip-options is requested from -22.9,-43.2 to -22.8,-43.1
    Then the response status is 200
    And the response has 1 trip option

  Scenario: Geocode results are returned as JSON
    Given the fake geocoder returns 1 result
    When GET /geocode is requested with q "Copacabana"
    Then the response status is 200
    And the response has 1 geocode result

  Scenario: Line vehicles are returned as JSON
    Given the fake planner returns 1 line vehicle
    When GET /line-vehicles is requested with line_code "178"
    Then the response status is 200
    And the response has 1 line vehicle

  Scenario: Train options are returned as JSON when a trip is found
    Given the fake train planner finds a trip
    When GET /train-options is requested from -22.9,-43.2 to -22.8,-43.1
    Then the response status is 200
    And the response has 1 train option

  Scenario: Train options are null when no trip is found
    Given the fake train planner finds no trip
    When GET /train-options is requested from -22.9,-43.2 to -22.8,-43.1
    Then the response status is 200
    And the response body is null

  Scenario: A query missing a required parameter is rejected
    When GET /nearby-stops is requested with no parameters
    Then the response status is 422
