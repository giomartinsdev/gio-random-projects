Feature: BRT position transformer
  As the brt_gps_poller flow
  I want BrtPositionTransformer to parse raw rows into typed captures
  So that one malformed row never drops every other vehicle's position

  Scenario: A well-formed row parses into a typed capture
    Given a well-formed BRT row for vehicle "901008" on line "35"
    When the rows are transformed
    Then 1 capture comes back
    And capture 0 has mode "brt", line "35", vehicle "901008"
    And capture 0's speed_kmh is 12.5

  Scenario: A malformed row is skipped without failing the batch
    Given a well-formed BRT row for vehicle "901008" on line "35"
    And a malformed BRT row missing "codigo"
    When the rows are transformed
    Then 1 capture comes back
    And capture 0 has vehicle "901008"

  Scenario: A missing velocidade defaults to zero
    Given a well-formed BRT row for vehicle "901008" on line "35" with no velocidade
    When the rows are transformed
    Then capture 0's speed_kmh is 0.0
