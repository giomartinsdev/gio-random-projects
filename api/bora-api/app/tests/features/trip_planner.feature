Feature: Trip planner
  As bora.'s core piece of business logic
  I want TripPlanner to find nearby stops and match direct lines with live ETAs
  So that a rider sees which bus to catch, from where, and roughly when it arrives

  Background:
    Given a fake domain client and cache

  Scenario: Nearby stops are sorted closest-first and limited
    Given stops "A" 100m away, "B" 300m away, and "C" 200m away from the search point
    When nearby stops are searched with radius 1000m and limit 2
    Then the nearby stops are "A" then "C"

  Scenario: A stop outside the radius is excluded
    Given stops "A" 100m away and "B" 2000m away from the search point
    When nearby stops are searched with radius 500m and limit 5
    Then the nearby stops are "A"

  Scenario: A direct line connecting origin and destination is found
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S1" then "S2" in that order
    When trip options are searched from the origin to the destination
    Then a trip option for line "178" comes back
    And its origin stop is "S1" and destination stop is "S2"

  Scenario: A line serving both stops in reverse order is not a valid direct match
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S2" then "S1" in that order
    When trip options are searched from the origin to the destination
    Then no trip options come back

  Scenario: No stops near the destination means no trip options
    Given stop "S1" is 50m from the origin
    And no stops are near the destination
    When trip options are searched from the origin to the destination
    Then no trip options come back

  Scenario: A line with a live vehicle reports an ETA
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S1" then "S2" in that order
    And a vehicle on line "178" is 1000m from "S1" traveling at 36 km/h
    When trip options are searched from the origin to the destination
    Then the line "178" option has an eta of about 100 seconds

  Scenario: A line with no live vehicle still comes back, without an eta
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S1" then "S2" in that order
    When trip options are searched from the origin to the destination
    Then the line "178" option has no eta

  Scenario: A route reachable via one transfer is found when no direct line exists
    Given stop "S1" is 50m from the origin
    And stop "T1" exists
    And stop "S2" is 50m from the destination
    And line "170" serves "S1" then "T1" in that order
    And line "270" serves "T1" then "S2" in that order
    When trip options are searched from the origin to the destination
    Then a trip option for line "170" comes back
    And its transfer is to line "270" at "T1"

  Scenario: A direct line is preferred over a transfer when both exist
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S1" then "S2" in that order
    And stop "T1" exists
    And line "170" serves "S1" then "T1" in that order
    And line "270" serves "T1" then "S2" in that order
    When trip options are searched from the origin to the destination
    Then exactly 1 trip option for line "178" comes back
    And no trip option has a transfer

  Scenario: A destination unreachable even via one transfer comes back empty
    Given stop "S1" is 50m from the origin
    And stop "T1" exists
    And stop "S2" is 50m from the destination
    And line "170" serves "S1" then "T1" in that order
    When trip options are searched from the origin to the destination
    Then no trip options come back

  Scenario: Riding the wrong direction on the second leg is not a valid transfer
    Given stop "S1" is 50m from the origin
    And stop "T1" exists
    And stop "S2" is 50m from the destination
    And line "170" serves "S1" then "T1" in that order
    And line "270" serves "S2" then "T1" in that order
    When trip options are searched from the origin to the destination
    Then no trip options come back

  Scenario: The same line reachable from two origin stops is reported only once
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And stop "S3" is 20m from the origin
    And line "178" serves "S1" then "S2" in that order
    And line "178" serves "S3" then "S2" in that order
    When trip options are searched from the origin to the destination
    Then exactly 1 trip option for line "178" comes back
    And its origin stop is "S3"

  Scenario: Every vehicle reporting on a line comes back
    Given stop "S1" is 0m from the origin
    And a vehicle on line "178" is 1000m from "S1" traveling at 36 km/h
    And another vehicle on line "178" is 500m from "S1" traveling at 20 km/h
    When line vehicles are searched for line "178"
    Then 2 line vehicles come back

  Scenario: A line with no vehicle reporting has none to show
    When line vehicles are searched for line "178"
    Then 0 line vehicles come back

  Scenario: A vehicle that stopped reporting a while ago doesn't count as live
    Given stop "S1" is 50m from the origin and stop "S2" is 50m from the destination
    And line "178" serves "S1" then "S2" in that order
    And a vehicle on line "178" is 1000m from "S1" but last reported 20 minutes ago
    When trip options are searched from the origin to the destination
    Then the line "178" option has no eta

  Scenario: A stale vehicle is excluded from the live map too
    Given stop "S1" is 0m from the origin
    And a vehicle on line "178" is 1000m from "S1" but last reported 20 minutes ago
    When line vehicles are searched for line "178"
    Then 0 line vehicles come back
