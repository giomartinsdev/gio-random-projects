Feature: Domain event store
  As an operator auditing this service
  I want every dispatched event to leave a record in domain_event_store
  So that I can reconstruct what happened and when, no matter which event it was

  Background:
    Given a domain API backed by a real Postgres database

  Scenario: Dispatching an event records it in the event store
    When a RecordVehiclePositions event is dispatched for vehicle "B1"
    Then exactly 1 event store record exists
    And the record's event type is "RecordVehiclePositions"
    And the record's entity type is "VehiclePosition"
    And the record's result is "1"

  Scenario: Each dispatched event gets its own record, in order
    When a RecordVehiclePositions event is dispatched for vehicle "B1"
    And the vehicle position history is listed
    Then the event store records these event types in order:
      | RecordVehiclePositions   |
      | ListVehiclePositionHistory |

  Scenario: A request that fails validation is rejected before dispatch
    When an invalid record-vehicle-positions request is sent
    Then the response status is 422
    And no event store record exists
