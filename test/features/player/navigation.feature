# covers: src/js/player.js, src/js/player/
Feature: Moving through a deck in the player

  The player is the page a deck exports; the audience sees it. These scenarios pin what
  the keys and the API do today, before the player code is reshaped.

  Background:
    Given the "basic" deck is built
    And the deck page is open

  @issue-36
  Scenario: The first frame is shown
    Then the player is on frame "One"
    And the page title contains "Basic"

  @issue-36
  Scenario: Right arrow and left arrow move one frame
    When the key "ArrowRight" is pressed
    Then the player is on frame "Two"
    When the key "ArrowLeft" is pressed
    Then the player is on frame "One"

  @issue-36
  Scenario: Space moves forward and the URL hash follows
    When the key " " is pressed
    Then the player is on frame "Two"
    And the URL hash names frame "frame2"

  @issue-36
  Scenario: End goes to the last frame and Home goes back to the first
    When the key "End" is pressed
    Then the player is on frame "Two"
    When the key "Home" is pressed
    Then the player is on frame "One"

  @issue-36
  Scenario: Page down and page up move one frame
    When the key "PageDown" is pressed
    Then the player is on frame "Two"
    When the key "PageUp" is pressed
    Then the player is on frame "One"
