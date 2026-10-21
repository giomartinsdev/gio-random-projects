# language: en
# The friend league. This is the part of the game people talk about on a Monday,
# so the rules have to be boringly explicit: when a matchday locks, who gets
# simulated, and who is champion when clubs end up in different divisions.

Feature: Friend league
  As a group of friends
  I want one shared season we all play at our own pace
  So that finishing above each other means something

  Scenario: A league needs at least two managers
    Given a league called "The Sunday Lads"
    When I try to create it with one manager
    Then it is refused
    And the reason mentions two managers

  Scenario: Two managers cannot take the same club
    Given a league called "The Sunday Lads"
    And a manager called "Gio" with Ashcombe Rovers
    When I add a manager called "Dan" with Ashcombe Rovers
    Then it is refused
    And the reason says the club is taken

  Scenario: The invite code is readable and stable
    Given a league called "The Sunday Lads"
    Then the invite code starts with "PYR-"
    And creating the same league again gives the same code

  Scenario: A matchday is not resolved until everyone has picked
    Given a league of six managers
    And five of them have submitted a mentality
    When I resolve the matchday
    Then it is refused
    And the message names the manager who has not submitted

  Scenario: Submitting a pick is the readiness signal
    Given a league of six managers
    And five of them have submitted a mentality
    Then the window is collecting
    When the sixth submits a mentality
    Then the window is locked

  Scenario: A missed deadline never holds the league hostage
    Given a league of six managers
    And one manager has not submitted
    When the deadline passes and the matchday is forced
    Then that manager's club is simulated
    And their missed deadline is counted
    And the matchday advances for everyone

  Scenario: Three consecutive missed deadlines hand the club to a caretaker
    Given a manager who has missed two deadlines
    When they miss a third
    Then their club is under a caretaker
    And the league can still resolve matchdays

  Scenario: A new manager can take over a caretaker club
    Given a club under a caretaker
    When a new manager takes it over
    Then the club is active again
    And its missed deadline count is zero

  # The friend table is not the division table. Only matches between two
  # managers count, so a 6-0 win over an AI club is worth nothing here.

  Scenario: Only matches between managers count for head-to-head
    Given a league where Ashcombe played Uppermill and Ashcombe played an AI club
    When I load the head-to-head for Ashcombe
    Then only the Uppermill match is counted

  Scenario: Head-to-head totals survive across seasons
    Given the same two managers met in two different seasons
    When I load the head-to-head
    Then both meetings are counted
    And the last meeting is the most recent one

  Scenario: Replaying a matchday cannot count a derby twice
    Given a league where Ashcombe beat Uppermill on matchday 1
    When the same matchday is recorded a second time
    Then that derby is counted once
    And the archive has one result

  Scenario: A result dated to the wrong week is not archived
    Given a result from season 2025 arriving while recording matchday 1 of 2026
    When the matchday is recorded
    Then the archive stays empty

  Scenario: The friend champion is the manager highest up the pyramid
    Given one manager finished 3rd in tier 5
    And another finished 1st in tier 6
    When the season is recorded
    Then the tier 5 manager is champion

  Scenario: A season cannot be crowned twice
    Given a season that has already been recorded
    When I record it again
    Then it is refused

  Scenario: Clubs freeze once the season kicks off
    Given a league that has played a matchday
    When a manager tries to change club
    Then it is refused
    And the message says clubs are locked
