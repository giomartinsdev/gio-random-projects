# language: en
# UI behaviour. These are the screens a player actually touches, and the two
# things that kill a management sim: not knowing what to do next, and not being
# able to tell why a result happened.

Feature: Career screen
  Scenario: The hub always offers the next action
    Given a new career in the browser
    Then I see the club name and the current league
    And I see a button to play the next match

  Scenario: Playing a match shows the result and the scorers
    Given a new career in the browser
    When I play the next match
    Then I see a scoreline
    And I see at least one match event

  Scenario: The squad screen lists players with positions and ratings
    Given a new career in the browser
    When I open the squad screen
    Then I see at least 18 players
    And every player shows a position and a rating

  Scenario: The table screen shows my club highlighted
    Given a new career in the browser
    When I open the table screen
    Then I see 20 clubs
    And my club row is highlighted

  # A management game that only prints a final score asks the player to trust a
  # number. Showing the eleven players shifting with the ball is the difference
  # between "the engine decided 2-1" and "I watched them lose the second ball".

  Scenario: Playing a match shows the eleven-a-side pitch
    Given a new career in the browser
    When I play the next match
    Then I see a pitch with 22 players
    And the match clock is running

  Scenario: Skipping goes straight to full time
    Given a new career in the browser
    When I play the next match
    And I skip to full time
    Then the match clock reads 90 minutes
    And the scoreline matches the final result

  Scenario: Replaying the same match gives the same shape
    Given the same match simulated twice
    Then the players stand in the same places at the same minute

  Scenario: A pitch frame always keeps the ball and the twenty-two players on the pitch
    Given any minute of any simulated match
    Then every player and the ball sit inside the pitch

  # ── The game layer ─────────────────────────────────────────────────────────
  # A management sim reads as a spreadsheet when its people have no faces. These
  # scenarios pin the presentation contract: identity must be deterministic, and
  # the match must be presented like a broadcast, not like a report.

  Scenario: Every player has a face, and the same player always has the same face
    Given a new career in the browser
    When I open the squad screen
    Then every player card shows a face
    And a player's face is identical after a reload

  Scenario: Every club has a badge
    Given a new career in the browser
    Then my club shows a crest
    And the crest is the same after a reload

  Scenario: A squad is presented as player cards, not a spreadsheet
    Given a new career in the browser
    When I open the squad screen
    Then I see a card for every player in the squad
    And each card shows a rating, a position and a face
    And the table view is still available for comparison

  Scenario: A goal is presented as a broadcast graphic
    Given a new career in the browser
    When I play the next match
    And I skip to full time
    Then every goal has a scorer who appears in the goals graphic

  Scenario: The match is framed as a broadcast
    Given a new career in the browser
    When I play the next match
    Then I see a score bug with both crests and the clock
    And I see a live ticker describing what the ball is doing

  Scenario: Real club data can be loaded without changing the game
    Given a snapshot from a data provider
    Then the clubs keep their real names, crests and player portraits
    And a club without a crest still renders a badge

  Scenario: The game plays without a data provider
    Given no snapshot is available
    Then the career starts in the invented pyramid
    And every player still has a face

  Scenario: A licensed world survives a season change
    Given a career built from a licensed snapshot
    When the season ends
    Then the clubs are the same clubs, not regenerated ones
    And my club keeps its badge and portrait identities

