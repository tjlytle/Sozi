# covers: src/js/presenter.js, src/templates/presenter.html
Feature: Presenter notes and counter

  The speaker reads the title of the current frame and the counter in the presenter.
  These scenarios pin that both follow the speaker's moves.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @issue-36
  Scenario: The notes show the title of the first frame
    Then the notes title is "One"

  @issue-36
  Scenario: Next updates the notes and the counter
    When the next button is pressed
    Then the notes title is "Two"
    And the frame counter reads "2 / 2"
