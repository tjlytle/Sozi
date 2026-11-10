# covers: src/js/player/PlayerController.js, src/js/player/Viewport.js, src/js/player/Camera.js
Feature: The mouse in the player

  A left click on the slide goes to the next frame and a right click goes back. The
  wheel zooms the view in and out without changing frame; with Shift held it rotates
  the view. Dragging the slide moves the view, and a drag is never taken for a click.
  A deck can turn mouse zoom off, and then the wheel does nothing.

  Background:
    Given the "basic" deck is built
    And the deck page is open

  @issue-238
  Scenario: Left click moves forward, right click moves back
    When the slide is clicked
    Then the player is on frame "Two"
    When the slide is right-clicked
    Then the player is on frame "One"

  @issue-238
  Scenario: The wheel zooms in without changing frame
    When the wheel turns up over the slide
    Then the view is zoomed in
    And the player is on frame "One"
    And a screenshot "player-zoomed" is saved

  @issue-238
  Scenario: Shift and the wheel rotate the view
    When the wheel turns up over the slide with Shift held
    Then the view is rotated

  @issue-238
  Scenario: A drag moves the view and is not a click
    When the slide is dragged 100 pixels to the left
    Then the view has moved
    And the player is on frame "One"

  @issue-238
  Scenario: The wheel does nothing when the deck turns mouse zoom off
    Given the deck turns mouse zoom off
    When the wheel turns up over the slide
    Then the view is not zoomed
