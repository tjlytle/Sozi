# covers: src/js/player/FrameURL.js
Feature: Back on the presenter page

  The presenter page is a page like any other: Back takes the speaker to the page they were
  on before it, however far the talk has moved. The previous, current and next previews
  follow the talk, but they are part of the presenter page and do not take over the tab's
  history, so moving the talk adds nothing for Back to undo.

  A deck in its own window is different: its address names its frame, and Back takes it to
  the frame before. That stays as it is (see player/navigation.feature).

  Background:
    Given the "basic" deck is built

  @issue-395
  Scenario: Back leaves the presenter page for the page before it
    Given the presenter page is open after another page
    When the next button is pressed
    And the previous button is pressed
    And Back is pressed on the presenter page
    Then the presenter page has gone back to the page before it

  @issue-395
  Scenario: Back from a second presenter page returns to the first
    Given the presenter page is open
    And the "basic" deck's presenter page is opened again in the same tab
    When the next button is pressed
    And Back is pressed on the presenter page
    Then the presenter page is open at its first address
    And the frame counter reads "2 / 2"
