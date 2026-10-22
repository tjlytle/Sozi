# covers: src/js/player.js, src/js/player/
Feature: Driving the player from code

  The presenter drives the audience window by posting messages to it, and the page
  exposes its objects as window.sozi. These scenarios pin that surface: a message is
  {name, args}, and the name is called as a method on the player controller.

  Background:
    Given the "basic" deck is built
    And the deck page is open

  @issue-36
  Scenario: jumpToFrame lands on the frame at that index
    When the player is asked to jump to frame index 1
    Then the player is on frame "Two"

  @issue-36
  Scenario: The presentation knows how many frames it has
    Then the presentation has 2 frames

  @issue-36
  Scenario: A jumpToFrame message moves the frame
    When a message "jumpToFrame" with the argument 1 is posted to the page
    Then the player is on frame "Two"

  @issue-36
  Scenario: A message with an unknown name leaves the frame alone
    When a message "noSuchMethod" with no arguments is posted to the page
    And the key "ArrowRight" is pressed
    Then the player is on frame "Two"

  @issue-36
  Scenario: The presenter's own messages move the frame
    When a message "moveToNext" with no arguments is posted to the page
    Then the player is on frame "Two"
    When a message "moveToPrevious" with no arguments is posted to the page
    Then the player is on frame "One"
