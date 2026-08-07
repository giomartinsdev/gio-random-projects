Feature: Haversine distance
  As every distance/ETA estimate in this service
  I want haversine_m to compute an accurate great-circle distance
  So that nearby-stop filtering and ETA math are built on a correct primitive

  Scenario: The distance between a point and itself is zero
    Given the point -22.9068,-43.1729
    When the distance to itself is computed
    Then the distance is 0 meters

  Scenario: A known distance between two Rio landmarks is approximately correct
    Given Copacabana Beach at -22.9711,-43.1822
    And Christ the Redeemer at -22.9519,-43.2105
    When the distance between them is computed
    Then the distance is within 200 meters of 3600 meters
