# covers: src/js/player/FrameList.js, src/js/player/FrameNumber.js
Feature: The frame list in the player

  The frame list is a table of contents that slides in from the side of the player
  page. The T key opens it and closes it again, and so do a click on the frame number
  and the middle mouse button. Clicking a title goes to that frame. Moving the mouse
  out of the list closes it.

  Background:
    Given the "basic" deck is built
    And the deck page is open

  @issue-238
  Scenario: T opens the frame list and T closes it
    When the key "t" is pressed
    Then the frame list is open
    And a screenshot "player-frame-list-open" is saved
    When the key "t" is pressed
    Then the frame list is closed

  @issue-238
  Scenario: Clicking the frame number opens the frame list
    When the frame number is clicked
    Then the frame list is open

  @issue-238
  Scenario: The middle button toggles the frame list
    When the slide is clicked with the middle button
    Then the frame list is open

  @issue-238
  Scenario: Clicking a title in the frame list goes to that frame
    When the key "t" is pressed
    And the frame list entry "Two" is clicked
    Then the player is on frame "Two"

  @issue-238
  Scenario: Moving the mouse out of the frame list closes it
    When the key "t" is pressed
    And the mouse leaves the frame list
    Then the frame list is closed
