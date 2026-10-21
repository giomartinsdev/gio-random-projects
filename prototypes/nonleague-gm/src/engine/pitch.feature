# language: en
# The ball. The pitch already has to agree with the scoreline; this file covers
# the other half of the promise — that the ball behaves like a football while it
# does so. Carried, passed, shot, and in the net when a goal is given.

Feature: The ball on the pitch
  As a manager watching my match
  I want the ball to be played, not to float
  So that the ninety minutes look like football and not a lava lamp

  Scenario: A carried ball is at the carrier's feet
    Given a match where the home side is in possession
    When the ball is being carried at minute 30
    Then the ball is within a touch of the player carrying it
    And that player is the one marked as having the ball

  Scenario: A pass leaves one player and reaches another
    Given a match with the ball in play
    When a pass is in flight
    Then the ball is between the passer and the receiver
    And the ball has lift

  Scenario: A goal is the ball crossing the line
    Given Ashcombe score in the 56th minute
    When the clock reaches the 56th minute
    Then the ball is inside the goal Ashcombe are attacking
    And the scoreline reads one goal for Ashcombe

  Scenario: The ball restarts from the centre after a goal
    Given a goal has just been scored
    When half a minute of play has passed
    Then the ball is back at the centre spot

  Scenario: Play is continuous — no teleporting
    Given any two consecutive beats of the ball
    Then the second starts where the first ended

  Scenario: The ball moves at a readable speed
    Given a pass in flight
    Then the duration of the pass is its distance divided by one constant speed
    And a long ball takes longer than a short one

  Scenario: A dead ball is placed, not rolled
    Given a goal left no minutes for a restart or a build-up
    When the next move begins
    Then the ball is placed at the striker's feet
    And that beat is marked as a dead ball

  Scenario: Play never stands still for two minutes
    Given the ball is sampled ten times a minute
    Then every two-minute window covers real ground

  Scenario: The ball never leaves the field of play
    Given the ball is sampled at every minute of the match
    Then it is always inside the pitch, including inside the net
