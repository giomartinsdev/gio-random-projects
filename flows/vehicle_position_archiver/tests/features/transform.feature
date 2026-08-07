Feature: Archive planner
  As the vehicle_position_archiver flow
  I want ArchivePlanner to keep only the newest N rows per vehicle
  So that VehiclePositionHistory stays bounded without losing recent data

  Scenario: Only rows beyond the keep count are archived, per vehicle
    Given 12 history rows for vehicle "B1" and 3 for vehicle "B2"
    When the archive is planned with keep_per_vehicle 10
    Then B1's 2 oldest rows are archived and B2 is untouched
    And the object key starts with "vehicle-position-history/" and ends with ".parquet"

  Scenario: The Parquet bytes contain exactly the archived rows
    Given 12 history rows for vehicle "B1" and 3 for vehicle "B2"
    When the archive is planned with keep_per_vehicle 10
    Then the Parquet file holds exactly 2 rows with speeds 10.0 and 11.0

  Scenario: No archive is needed when every vehicle is within the keep count
    Given 3 history rows for vehicle "B1"
    When the archive is planned with the default keep_per_vehicle
    Then nothing is archived
