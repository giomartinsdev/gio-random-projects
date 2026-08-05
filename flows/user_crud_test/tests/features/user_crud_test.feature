Feature: User CRUD lifecycle through the gateway
  As an operator
  I want the gateway's User create/get/update/delete events to behave correctly end to end
  So that a full CRUD lifecycle can be trusted to work in production

  Scenario: Creating a user returns the created row
    Given a user payload with name "gio" and email "gio@example.com"
    When the user is created
    Then the created user has an id
    And the created user's name is "gio"

  Scenario: A created user can be fetched by id
    Given a user payload with name "ana" and email "ana@example.com"
    When the user is created
    And the user is fetched by id
    Then the fetched user matches the created user

  Scenario: Updating a user changes only the requested field
    Given a user payload with name "gio" and email "gio@example.com"
    When the user is created
    And the user's name is updated to "gio martins"
    Then the updated user's name is "gio martins"
    And the updated user's email is "gio@example.com"

  Scenario: Deleting a user removes it
    Given a user payload with name "gio" and email "gio@example.com"
    When the user is created
    And the user is deleted
    Then the delete reports success
    And fetching the user by id returns nothing
