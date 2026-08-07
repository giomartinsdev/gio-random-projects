Feature: MinIO client Cloudflare Access headers
  As the domain
  I want get_s3_client() to attach Cloudflare Access Service Token headers
  to every outgoing request when they're configured
  So that MinIO's Access-protected hostname doesn't silently swap S3
  responses for an HTML login redirect (see object_storage.py's module docstring)

  # No testcontainer here on purpose: this is a pure function over a
  # botocore before-send hook, no network or infrastructure boundary to
  # containerize — see api/domain/README's testing notes.

  Scenario: Headers are injected when CF Access env vars are set
    Given CF_ACCESS_CLIENT_ID is set to "test-id"
    And CF_ACCESS_CLIENT_SECRET is set to "test-secret"
    When the before-send hook runs against an outgoing request
    Then the request carries CF-Access-Client-Id "test-id"
    And the request carries CF-Access-Client-Secret "test-secret"

  Scenario: No headers are added when CF Access env vars are unset
    Given CF_ACCESS_CLIENT_ID is not set
    And CF_ACCESS_CLIENT_SECRET is not set
    When the before-send hook runs against an outgoing request
    Then the request carries no extra headers

  Scenario: No headers are added when only one CF Access env var is set
    Given CF_ACCESS_CLIENT_ID is set to "test-id"
    And CF_ACCESS_CLIENT_SECRET is not set
    When the before-send hook runs against an outgoing request
    Then the request carries no extra headers
