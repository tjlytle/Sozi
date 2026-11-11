# covers: src/js/player/PlayerKeys.js, src/js/player/PlayerController.js
Feature: The keys that change the view in the player

  Besides the keys that move between frames, a few keys change the view without
  leaving the frame: "+" zooms in and "-" zooms out about the middle of the window,
  "r" and "R" rotate the view. A deck can turn keyboard zoom off, and then "+" does
  nothing.

  Background:
    Given the "basic" deck is built
    And the deck page is open

  @issue-407
  Scenario: Plus zooms in without changing frame
    When the key "+" is pressed
    Then the view is zoomed in
    And the player is on frame "One"

  @issue-407
  Scenario: R rotates the view
    When the key "r" is pressed
    Then the view is rotated

  @issue-407
  Scenario: Plus does nothing when the deck turns keyboard zoom off
    Given the deck turns keyboard zoom off
    When the key "+" is pressed
    Then the view is not zoomed
