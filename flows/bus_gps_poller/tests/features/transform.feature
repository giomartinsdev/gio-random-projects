Feature: SPPO position transformer
  As the bus_gps_poller flow
  I want BusPositionTransformer to parse raw SPPO rows into typed captures
  So that one malformed row never drops every other vehicle's position

  Scenario: A well-formed row parses into a capture
    Given a well-formed SPPO row for vehicle "B25611" on line "606"
    When the rows are transformed
    Then 1 capture comes back
    And capture 0 has mode "sppo", line "606", vehicle "B25611"
    And capture 0's latitude is -22.90434

  Scenario: A malformed row is skipped without failing the batch
    Given a well-formed SPPO row for vehicle "B1" on line "606"
    And a malformed SPPO row missing "id_veiculo"
    When the rows are transformed
    Then 1 capture comes back
    And capture 0 has vehicle "B1"

  Scenario: A missing velocidade defaults to zero
    Given a well-formed SPPO row for vehicle "B1" on line "606" with no velocidade
    When the rows are transformed
    Then capture 0's speed_kmh is 0.0

  Scenario: The feed's misleading "Z" is corrected to a real UTC instant
    Given a row with datetime "2026-08-08T15:33:59Z" for vehicle "B1" on line "606"
    When the rows are transformed
    Then capture 0's captured_at is "2026-08-08T18:33:59+00:00"
