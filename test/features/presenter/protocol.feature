# covers: src/js/presenter.js, src/js/player.js, src/js/player/DisplayChannel.js, src/js/player/DisplayCommands.js, src/js/player/PreviewMode.js, src/js/player/Player.js, src/js/protocol/LocalTransport.js, src/js/protocol/messages.js
Feature: The presenter and the display talk one protocol

  The speaker sees no change: the presenter page opens the audience window, Next,
  Previous and the keys move it, and "." blanks it and brings it back. Underneath, the
  presenter and the display exchange the messages documented in
  docs/presenter-protocol.md, and each side listens only to the window it is bound to.
  A message that comes from anywhere else, even from the presenter page itself, changes
  nothing.

  However the speaker comes back to the presenter page in the same tab, the audience window
  stays on its frame and the room sees nothing happen; the presenter page catches up with
  the talk. If the speaker closed the audience window, coming back opens a new one at the
  first frame.

  Each deck has its own audience window, even two decks with the same file name in different
  folders: opening another deck's presenter page in the same tab opens that deck's window at
  its first frame and leaves the first deck's window on its frame.

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

  @issue-269
  Scenario: Going to the presenter page's address again leaves the talk where it is
    When the next button is pressed
    And the audience window is on frame "Two"
    And the presenter page is opened again at its address
    Then the audience window is on frame "Two"
    And the frame counter reads "2 / 2"

  @issue-269
  Scenario: Going back to the presenter page leaves the talk where it is
    When the next button is pressed
    And the audience window is on frame "Two"
    And the speaker leaves the presenter page and goes back to it
    Then the audience window is on frame "Two"
    And the frame counter reads "2 / 2"

  @issue-269
  Scenario: Reloading the presenter page leaves the talk where it is
    When the next button is pressed
    And the audience window is on frame "Two"
    And the presenter page is reloaded
    Then the audience window is on frame "Two"
    And the frame counter reads "2 / 2"

  @issue-269
  Scenario: Returning after the audience window was closed opens it at the first frame
    When the next button is pressed
    And the audience window is on frame "Two"
    And the audience window is closed
    And the presenter page is reloaded and opens a new audience window
    Then the audience window is on frame "One"
    And the frame counter reads "1 / 2"

  @issue-310
  Scenario: Another deck's presenter page in the same tab gets its own audience window
    Given a second copy of the "basic" deck is built in another folder
    When the next button is pressed
    And the audience window is on frame "Two"
    And the second deck's presenter page is opened in the same tab
    Then the audience window shows the second deck
    And the audience window is on frame "One"
    And the frame counter reads "1 / 2"
    And the first deck's audience window is still on frame "Two"

  @issue-310
  Scenario: The second deck's presenter moves only its own audience window
    Given a second copy of the "basic" deck is built in another folder
    When the second deck's presenter page is opened in the same tab
    And the key "." is pressed on the presenter page
    Then the audience window is blank
    And the first deck's audience window is not blank

  @issue-310
  Scenario: Returning to the first deck's presenter page finds its audience window again
    Given a second copy of the "basic" deck is built in another folder
    When the next button is pressed
    And the audience window is on frame "Two"
    And the second deck's presenter page is opened in the same tab
    And the first deck's presenter page is opened again in the same tab
    Then no new audience window was opened
    And the audience window is on frame "Two"
    And the frame counter reads "2 / 2"
