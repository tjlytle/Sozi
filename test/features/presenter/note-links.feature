# covers: src/js/presenter/panels/NotesPanel.js, src/js/presenter/noteLinks.js, src/js/presenter/NoteLinks.js, src/js/presenter.js, src/templates/presenter.html, test/fixtures/frame-links.sozi.json
Feature: Links to frames in the notes

  An author can link from the notes to another frame of the deck, with the frame's id
  (`#frame2`) or its number (`#3`). When the speaker clicks such a link in the Notes panel,
  the audience window goes to that frame, with its transition, as the Frames panel does;
  with Shift it jumps there at once. The presenter page itself stays where it is: its
  address does not change and the talk goes on.

  A link to a frame the deck does not have is drawn as broken, with a tooltip that names
  the missing frame, and clicking it does nothing. Any other link opens in a new tab, so
  that a click in the notes never replaces the presenter page.

  The "frame-links" deck has three frames, One, Two and Three, with the ids frame1, frame2
  and frame3. Frame One's notes link to "#frame2" ("to two"), "#3" ("to three"),
  "https://example.org" ("out") and "#nowhere" ("gone").

  Background:
    Given the "frame-links" deck is built
    And the presenter page is open

  @issue-319
  Scenario: A link to a frame id moves the display, and the presenter page stays
    When the notes link "to two" is clicked
    Then the audience window is on frame "Two"
    And the frame counter reads "2 / 3"
    And the presenter page's address is unchanged

  @issue-319
  Scenario: A link to a frame number moves the display to that frame
    When the notes link "to three" is clicked
    Then the audience window is on frame "Three"

  @issue-319
  Scenario: Shift on a frame link jumps without the transition
    When the notes link "to two" is clicked with Shift
    Then the audience window is on frame "Two" with no transition running

  @issue-319 @issue-274
  Scenario: An external link opens in a new tab and the presenter keeps running
    When the notes link "out" is clicked
    Then a new page opens at "https://example.org"
    And the presenter page's address is unchanged
    And the frame counter reads "1 / 3"

  @issue-319
  Scenario: A link to a missing frame is marked broken and moves nothing
    Then the notes link "gone" is marked broken
    When the notes link "gone" is clicked
    Then the audience window stays on frame "One"
    And the presenter page's address is unchanged
    And a screenshot "notes-frame-links" is saved
