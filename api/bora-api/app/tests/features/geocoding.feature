Feature: Destination geocoding
  As bora-api
  I want NominatimGeocoder to search OpenStreetMap scoped to Rio de Janeiro
  So that a rider can type a free-text destination instead of only picking from a map

  Background:
    Given a fake Nominatim endpoint

  Scenario: A search returns typed results
    Given Nominatim returns 2 results
    When "Copacabana" is searched with limit 5
    Then 2 geocode results come back

  Scenario: The search is scoped to Rio de Janeiro's bounding box
    When "Copacabana" is searched with limit 5
    Then the request's viewbox is bounded to Rio de Janeiro

  Scenario: The request carries an identifying User-Agent
    When "Copacabana" is searched with limit 5
    Then the request has a non-empty User-Agent header
