Feature: Object storage events
  As the domain
  I want CreateBucket/PutObject/GetObject/ListObjects/DeleteObject to behave
  exactly like real MinIO, not a stand-in for it
  So that callers (like flows/vehicle_position_archiver) can trust the contract

  Background:
    Given a domain API backed by a real Postgres database and a real MinIO server

  Scenario: Creating a bucket creates it
    When bucket "reports" is created
    Then the response is true

  Scenario: Creating the same bucket again is idempotent
    Given bucket "reports" already exists
    When bucket "reports" is created
    Then the response is false

  Scenario: Put then get round-trips binary data intact
    Given bucket "reports" already exists
    When binary data is put at key "2026/report.bin" in bucket "reports"
    And key "2026/report.bin" is fetched from bucket "reports"
    Then the fetched object's content type is "application/octet-stream"
    And the fetched object's body matches what was put

  Scenario: Getting a missing key returns nothing, not an error
    Given bucket "reports" already exists
    When key "does-not-exist" is fetched from bucket "reports"
    Then the response is null

  Scenario: Listing objects returns only keys under the given prefix
    Given bucket "reports" already exists
    And keys "2026/a.bin", "2026/b.bin" and "2025/c.bin" exist in bucket "reports"
    When objects under prefix "2026/" in bucket "reports" are listed
    Then the listed keys are exactly "2026/a.bin" and "2026/b.bin"

  Scenario: Listing an empty bucket returns nothing
    Given bucket "reports" already exists
    When all objects in bucket "reports" are listed
    Then the listed keys are exactly none

  Scenario: Deleting an object removes it
    Given bucket "reports" already exists
    And key "gone.bin" exists in bucket "reports"
    When key "gone.bin" in bucket "reports" is deleted
    Then the response is true
    When key "gone.bin" is fetched from bucket "reports"
    Then the response is null

  Scenario: Putting into a bucket that doesn't exist fails loudly
    When binary data is put at key "x.bin" in bucket "does-not-exist"
    Then the request fails with a real S3 error
