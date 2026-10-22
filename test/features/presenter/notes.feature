# covers: src/js/presenter.js, src/templates/presenter.html
Feature: Presenter notes and counter

  The speaker reads the title of the current frame and the counter in the presenter.
  These scenarios pin how both behave when the speaker moves back, runs past the end,
  or uses the keyboard on the presenter page. Next on the last frame cycles to the first
  (Player.nextFrame wraps). Pressing Next again while the previous transition is still
  running is not pinned here; see issue #49.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @issue-36
  Scenario: Next then previous returns the counter and the notes to the first frame
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    When the previous button is pressed
    Then the frame counter reads "1 / 2"
    And the notes title is "One"

  @issue-36
  Scenario: Next on the last frame cycles to the first frame
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    When the audience transition has finished
    And the next button is pressed
    And the audience transition has finished
    Then the frame counter reads "1 / 2"
    And the notes title is "One"
    And the audience window is on frame "One"

  @issue-36
  Scenario: The keyboard on the presenter page moves both pages
    When the key "ArrowRight" is pressed on the presenter page
    Then the frame counter reads "2 / 2"
    And the audience window is on frame "Two"
    When the key "ArrowLeft" is pressed on the presenter page
    Then the frame counter reads "1 / 2"
    And the audience window is on frame "One"
