# covers: src/js/presenter.js, src/js/player.js, src/js/player/DisplayChannel.js, src/js/player/PreviewMode.js, src/js/player/Player.js, src/js/protocol/LocalTransport.js, src/js/protocol/messages.js
Feature: The presenter and the display talk one protocol

  The speaker sees no change: the presenter page opens the audience window, Next,
  Previous and the keys move it, and "." blanks it and brings it back. Underneath, the
  presenter and the display exchange the messages documented in
  docs/presenter-protocol.md, and each side listens only to the window it is bound to.
  A message that comes from anywhere else, even from the presenter page itself, changes
  nothing.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @issue-28
  Scenario: Blank from the presenter blanks the audience window, Next brings it back
    When the key "." is pressed on the presenter page
    Then the audience window is blank
    When the next button is pressed
    Then the audience window is not blank
    And the audience window is on frame "Two"

  @issue-28
  Scenario: Shift+End and Home reach the last and first frames on both pages
    When the key "Shift+End" is pressed on the presenter page
    Then the frame counter reads "2 / 2"
    And the audience window is on frame "Two"
    When the key "Home" is pressed on the presenter page
    Then the frame counter reads "1 / 2"
    And the audience window is on frame "One"

  @issue-28
  Scenario: A frame change from a window other than the display is ignored
    When the presenter page posts itself a frame change to index 1
    Then the frame counter reads "1 / 2"
    And the notes title is "One"
