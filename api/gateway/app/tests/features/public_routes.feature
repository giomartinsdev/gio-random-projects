Feature: Gateway public routes
  As the bora. frontend
  I want /nearby-stops, /trip-options, and /geocode proxied to bora-api without an API key
  So that an anonymous browser can reach bora-api through the one public entry point

  Background:
    Given a gateway proxying to a real upstream server

  Scenario: Nearby-stops is forwarded to bora-api without requiring an API key
    When "/nearby-stops" is requested without an API key
    Then the response status is 200
    And upstream received the request at "/nearby-stops"
    And upstream did not see an X-API-Key header

  Scenario: Trip-options is forwarded to bora-api without requiring an API key
    When "/trip-options" is requested without an API key
    Then the response status is 200
    And upstream received the request at "/trip-options"

  Scenario: Geocode is forwarded to bora-api without requiring an API key
    When "/geocode" is requested without an API key
    Then the response status is 200
    And upstream received the request at "/geocode"

  Scenario: A request from an allowed frontend origin gets CORS headers back
    When "/nearby-stops" is requested from origin "http://localhost:5173"
    Then the response allows the origin "http://localhost:5173"

  Scenario: A request from an origin that isn't configured gets no CORS headers
    When "/nearby-stops" is requested from origin "http://evil.example"
    Then the response has no CORS allow-origin header
