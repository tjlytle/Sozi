# covers: src/js/player/TouchGestures.js, src/js/player/PlayerController.js, src/js/player/Viewport.js, src/js/player/FrameList.js
Feature: Touch in the player

  On a tablet or a phone, the audience page answers to fingers. A quick swipe to the
  left goes to the next frame and a quick swipe to the right goes back; a tap goes
  forward like a click. A slow drag moves one frame once it has crossed half the screen,
  and never two. Two fingers spread apart zoom in, two fingers moved together pan the
  view. A finger held still does nothing. When the frame list is open, a finger on the
  slide closes it, and a finger on a title in the list goes to that frame.

  The touches are real ones, sent through Chromium's touch input, not events built in
  the page.

  Background:
    Given the "basic" deck is built
    And the deck page is open on a touch screen

  @issue-238
  Scenario: A quick swipe to the left moves to the next frame, to the right moves back
    When a finger swipes left quickly
    Then the player is on frame "Two"
    When a finger swipes right quickly
    Then the player is on frame "One"

  @issue-238
  Scenario: A tap moves to the next frame
    When a finger taps the slide
    Then the player is on frame "Two"

  @issue-238
  Scenario: A slow drag across half the screen moves one frame, not two
    When a finger drags slowly from the right edge to the left edge
    Then the player is on frame "Two"

  @issue-238
  Scenario: Two fingers spread apart zoom in
    When two fingers spread apart on the slide
    Then the view is zoomed in
    And the player is on frame "One"

  @issue-238
  Scenario: Two fingers moved together pan the view
    When two fingers move 100 pixels to the right
    Then the view has moved

  @issue-238
  Scenario: A finger held still for half a second does nothing
    When a finger touches the slide for 500 milliseconds
    Then the player is on frame "One"

  @issue-245
  Scenario: A tap on the slide closes the open frame list
    When the key "t" is pressed
    Then the frame list is open
    When a finger taps the slide
    Then the frame list is closed

  @issue-245
  Scenario: A tap on a title in the open frame list goes to that frame
    When the key "t" is pressed
    And a finger taps the frame list entry "Two"
    Then the player is on frame "Two"
    And the frame list is open
