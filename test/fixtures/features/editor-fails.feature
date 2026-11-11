Feature: An editor scenario that fails on purpose

  test/unit/support/electron.test.js runs this file to check that a failing editor
  scenario gets a screenshot of its window attached. It sits outside test/features so
  the suite never runs it.

  Scenario: The editor is open when a step fails
    Given the editor is open on a copy of the basic deck
    Then this step fails on purpose
