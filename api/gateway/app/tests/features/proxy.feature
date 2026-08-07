Feature: Gateway proxy
  As a caller of the gateway
  I want it to authenticate, forward, and bound every request to the real upstream
  So that only genuine credentialed traffic reaches the domain, intact

  Background:
    Given a gateway proxying to a real upstream server

  Scenario: A request without an API key is rejected
    When a request without an API key hits a proxied route
    Then the gateway rejects it with status 401

  Scenario: A request with the wrong API key is rejected
    When a request with an unconfigured API key hits a proxied route
    Then the gateway rejects it with status 401

  Scenario: A valid request is forwarded with query params intact
    When a valid request with query param id=42 is proxied
    Then the response status is 200
    And upstream saw query param id "42"

  Scenario: A repeated query param's every value reaches upstream
    When a valid delete request with repeated ids 1, 2 and 3 is proxied
    Then upstream saw ids "1", "2" and "3"

  Scenario: The gateway's own API key header is never forwarded upstream
    When a valid request with query param id=1 is proxied
    Then upstream did not see an X-API-Key header

  Scenario: A POST body is forwarded to upstream
    When a valid create-user request with name "gio" is proxied
    Then the response status is 200
    And upstream reports it created "gio"

  Scenario: The health endpoint requires no auth
    When /health is requested without an API key
    Then the response status is 200

  Scenario: A request over the body size cap is rejected before reaching upstream
    Given the body size cap is set to 10 bytes
    When a valid create-user request with name "x" repeated 100 times is proxied
    Then the gateway rejects it with status 413

  Scenario: A request within the body size cap is still forwarded
    Given the body size cap is set to 10000 bytes
    When a valid create-user request with name "gio" is proxied
    Then the response status is 200

  Scenario: Requests over the rate limit are throttled
    Given the rate limit is set to 2 per minute
    When 3 requests are sent in a row with a fresh API key under that limit
    Then the first 2 succeed and the 3rd is rejected with status 429
    And the 429 response carries a Retry-After header
