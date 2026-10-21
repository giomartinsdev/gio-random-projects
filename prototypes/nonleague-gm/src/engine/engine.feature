# language: en
# Engine behaviour for the Pyramid prototype.
#
# The point of these scenarios: the game must be *decidable* and *fair*. A
# prototype that "feels" random is worthless, because you cannot tell whether
# your tactic worked or you got lucky. So every source of chance is a seeded
# PRNG that the career owns, and every rule below is an assertion, not a vibe.
#
# These run headless (vitest, node-ish env) with no browser. The UI is covered
# separately in ui.feature.

Feature: Match simulation
  As a manager
  I want results to follow from squad strength, tactics and home advantage
  So that decisions matter more than luck

  Scenario: A much stronger side wins most of the time
    Given a seeded career
    And a home side rated 85 attack and 85 defence
    And an away side rated 45 attack and 45 defence
    When I simulate 200 matches between them
    Then the home side wins at least 70% of them

  Scenario: Home advantage is real but not decisive
    Given a seeded career
    And two identical sides rated 60 attack and 60 defence
    When I simulate 400 matches between them
    Then the home side wins between 35% and 60% of them

  Scenario: A cautious mentality reduces both goals scored and conceded
    Given a seeded career
    And an identical fixture played twice with the same seed
    When one match is played cautious and the other attacking
    Then the cautious match has no more total goals than the attacking match

  Scenario: Every match produces a consistent scoreline
    Given a seeded career
    And any fixture
    When the match is simulated
    Then the home goals equal the number of home scorers
    And the away goals equal the number of away scorers
    And the result matches the scoreline

  Scenario: The same seed and the same inputs give the same match
    Given a seeded career
    When I simulate the same fixture twice with seed 12345
    Then both matches have the same scoreline and the same scorers

  Scenario: Two different seeds give different matches
    Given a seeded career
    When I simulate the same fixture with seed 1 and with seed 2
    Then the two scorelines are not always identical

Feature: League season
  As a manager
  I want a real league structure
  So that promotion means something

  Scenario: A season has a full double round-robin
    Given a league of 20 clubs
    When the fixture list is built
    Then there are 380 fixtures
    And every club plays 38 matches
    And every club plays every other club home and away

  Scenario: The table orders by points, then goal difference, then goals scored
    Given a league with finished results
    When the table is computed
    Then clubs are ordered by points descending
    And clubs level on points are ordered by goal difference descending
    And clubs still level are ordered by goals scored descending

  Scenario: The bottom three are relegated and the top two promoted
    Given a finished season
    When the season is resolved
    Then the bottom three clubs are relegated
    And the top two clubs are promoted
    And the clubs in third to sixth enter the play-offs

  Scenario: Play-off winner is promoted as the third club
    Given a finished season with a play-off
    When the play-offs are resolved
    Then exactly one club is promoted through the play-offs

  Scenario: A club cannot be promoted out of the top tier
    Given a club in the top tier
    When the season is resolved
    Then no club is promoted from the top tier

  Scenario: A club cannot be relegated out of the bottom tier
    Given a club in the bottom tier
    When the season is resolved
    Then no club is relegated from the bottom tier

Feature: Club economy
  As a chairman
  I want money to follow performance and crowds
  So that the club can grow, or go under

  Scenario: A home match pays gate receipts
    Given a club with a 5,000 capacity stadium and a £10 ticket price
    When the club plays a home match in front of 4,000 people
    Then the club receives £40,000 in gate receipts

  Scenario: Wages are deducted every week
    Given a club with a £12,000 weekly wage bill
    When a week passes
    Then the club balance falls by £12,000 plus the week's other costs

  Scenario: A better league position attracts bigger crowds
    Given two identical clubs, one top of the table and one bottom
    When both play at home
    Then the club at the top has the larger attendance

  Scenario: Attendance never exceeds stadium capacity
    Given a club with a 2,000 capacity stadium and maximum fan mood
    When the club plays at home
    Then the attendance is at most 2,000

  Scenario: A club in debt cannot sign a player it cannot afford
    Given a club with a negative balance and no transfer budget
    When it tries to sign a player who costs money
    Then the signing is rejected with a reason

  Scenario: A free agent can be signed at any time
    Given a club with a negative balance
    And a free agent who asks no fee
    When it signs that free agent
    Then the signing succeeds and the squad grows by one

  Scenario: A stadium upgrade costs money and raises capacity
    Given a club with enough money
    When it upgrades the stadium
    Then the balance falls by the upgrade cost
    And the capacity increases

  Scenario: A stadium upgrade is refused without the money
    Given a club without enough money
    When it upgrades the stadium
    Then the upgrade is rejected and the capacity is unchanged

Feature: Career progression
  As a player
  I want a career that can be saved, advanced and lost
  So that the prototype is a game and not a demo

  Scenario: A new career starts in the bottom tier with a full squad
    Given a new career for a bottom-tier club
    Then the squad has at least 18 players
    And the club is in the bottom tier
    And the balance is positive

  Scenario: Advancing a week plays the fixture and updates the table
    Given a new career
    When I advance one week
    Then a match has been played
    And the league table shows the result
    And the week counter has increased

  Scenario: Advancing a full season ends the season and applies promotion
    Given a new career
    When I advance until the season ends
    Then the season is marked complete
    And the final table has every club with 38 matches

  Scenario: A career survives a save and load round trip
    Given a career several weeks in
    When I save it and load it back
    Then the loaded career is identical to the saved one
    And the loaded career can continue advancing

  Scenario: The board sacks a manager who loses every match
    Given a career where the club loses every remaining match
    When the board reviews the season
    Then the manager is dismissed

  Scenario: The board keeps a manager who wins the league
    Given a career where the club wins every remaining match
    When the board reviews the season
    Then the manager keeps the job

  Scenario: An invalid command is rejected without changing the career
    Given a career
    When I try to advance a week that does not exist
    Then the command is rejected with a reason
    And the career is unchanged
