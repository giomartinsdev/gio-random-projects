Feature: Train planner
  As bora.'s rail companion to the bus TripPlanner
  I want to match a rider's origin/destination to the nearest SuperVia stations and plan between them
  So that a rider near a train line sees that option too, not just buses

  Background:
    Given a fake trensrj client and station list

  Scenario: A station within range on both ends plans a trip
    Given station "central" "Central do Brasil" is 500m from the origin
    And station "belford-roxo" "Belford Roxo" is 500m from the destination
    And trensrj returns 1 trip option between "central" and "belford-roxo"
    When train options are searched from the origin to the destination
    Then a train trip is found
    And its origin station is "Central do Brasil" and destination station is "Belford Roxo"
    And 1 train option comes back

  Scenario: No station within range of the origin means no trip
    Given station "belford-roxo" "Belford Roxo" is 500m from the destination
    When train options are searched from the origin to the destination
    Then no train trip is found

  Scenario: The same nearest station on both ends means no trip
    Given station "central" "Central do Brasil" is 500m from the origin
    And station "central" "Central do Brasil" is 500m from the destination
    When train options are searched from the origin to the destination
    Then no train trip is found

  Scenario: A station outside the max distance is not considered nearby
    Given station "far-away" "Far Away" is 5000m from the origin
    And station "belford-roxo" "Belford Roxo" is 500m from the destination
    When train options are searched from the origin to the destination
    Then no train trip is found
