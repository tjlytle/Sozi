Feature: A scenario that fails on purpose

  test/unit/support/world.test.js runs this file to check that a failing browser
  scenario gets its screenshot attached. It sits outside test/features so the suite
  never runs it.

  Scenario: The deck page is open when a step fails
    Given the "basic" deck is built
    And the deck page is open
    Then this step fails on purpose
