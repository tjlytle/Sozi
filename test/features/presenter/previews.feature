# covers: src/js/presenter.js, src/templates/presenter.html
Feature: Presenter previews and navigation

  The presenter page is what the speaker looks at. It opens the presentation in its
  own window for the audience and shows, for itself, the current frame large with the
  previous and next frames beside it, the frame counter, and the notes of the current
  frame. The speaker moves the talk from the presenter and the audience window follows.

  This file is the template for every feature file: a prose description of what a
  person expects, then the scenarios that prove it, each tagged with its issue. The
  first line names the source files the scenarios cover (standard 6.2).

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @foundation
  Scenario: The presenter shows the first frame and the frame count on open
    Then the frame counter reads "1 / 2"
    And the notes title is "One"

  @foundation
  Scenario: Next moves the audience window and the presenter together
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    And the notes title is "Two"
    And the audience window is on frame "Two"

  @foundation
  Scenario: Previous moves back
    When the next button is pressed
    And the previous button is pressed
    Then the frame counter reads "1 / 2"
    And a screenshot "presenter-first-frame" is saved
