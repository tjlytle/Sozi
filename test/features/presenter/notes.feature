# covers: src/js/presenter.js, src/templates/presenter.html
Feature: Presenter notes and counter

  The speaker reads the title of the current frame and the counter in the presenter.
  These scenarios pin how both behave when the speaker moves back, runs past the end,
  or uses the keyboard on the presenter page.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @issue-36
  Scenario: Next then previous returns the counter and the notes to the first frame
    When the next button is pressed
    And the previous button is pressed
    Then the frame counter reads "1 / 2"
    And the notes title is "One"

  @issue-36
  Scenario: Next on the last frame stays on the last frame
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    And the notes title is "Two"

  @issue-36
  Scenario: The keyboard on the presenter page moves both pages
    When the key "ArrowRight" is pressed on the presenter page
    Then the frame counter reads "2 / 2"
    And the audience window is on frame "Two"
    When the key "ArrowLeft" is pressed on the presenter page
    Then the frame counter reads "1 / 2"
    And the audience window is on frame "One"

  # pins today's behaviour; see issue: two Next presses in quick succession, the second
  # during the first transition, leave both pages on the first frame.
  @issue-36
  Scenario: Two quick Next presses do not advance
    When the next button is pressed
    And the next button is pressed
    Then the audience window is on frame "One"
    And the frame counter reads "1 / 2"
