Feature: GTFS extractor
  As the gtfs_importer flow
  I want GtfsExtractor to download the feed zip and parse its CSVs into raw rows
  So that the transform stage never has to touch zip/CSV mechanics itself

  Background:
    Given a fake GTFS feed endpoint

  Scenario: The extractor parses every configured CSV file from the zip
    Given the feed zip contains 2 stops, 1 route, 1 trip, and 3 stop_times rows
    When the GTFS feed is extracted
    Then the parsed tables have 2 stops, 1 route, 1 trip, and 3 stop_times rows

  Scenario: A BOM at the start of a CSV file doesn't corrupt its first column
    Given the feed zip's stops.txt starts with a UTF-8 BOM
    When the GTFS feed is extracted
    Then the first stop's stop_id column is read correctly
