Feature: Vehicle position archiver end to end
  As an operator
  I want a full archive run to fetch, plan, and apply the prune correctly
  So that VehiclePositionHistory stays bounded on schedule

  Scenario: A vehicle with more than the keep count gets archived
    Given a fake gateway with 12 history rows for one vehicle
    When an archive run happens
    Then 2 rows were uploaded to MinIO and deleted from the domain

  Scenario: No vehicle over the keep count needs nothing archived
    Given a fake gateway with 3 history rows for one vehicle
    When an archive run happens
    Then nothing was uploaded or deleted
