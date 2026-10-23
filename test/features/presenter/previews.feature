# covers: src/js/presenter.js, src/js/player.js, src/js/protocol/viewport.js, src/templates/presenter.html
Feature: Presenter previews and navigation

  The presenter page is what the speaker looks at. It opens the presentation in its
  own window for the audience and shows, for itself, the current frame large with the
  previous and next frames beside it, the frame counter, and the notes of the current
  frame. The speaker moves the talk from the presenter and the audience window follows.

  The three previews have the shape of the audience window, letterboxed inside the box
  the layout gives them, so the speaker sees the crop the room sees. They follow the
  audience window when it is resized, and only the audience window: resizing the
  presenter page moves the boxes, not the shape. Until the audience window has said how
  big it is, the previews take the deck's own aspect ratio, 16:9 for the "basic" deck.

  This file is the template for every feature file: a prose description of what a
  person expects, then the scenarios that prove it, each tagged with its issue. The
  first line names the source files the scenarios cover (standard 6.2).

  Background:
    Given the "basic" deck is built

  Rule: With the audience window open

    Background:
      Given the presenter page is open

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

    @issue-25
    Scenario: Previews take the shape of the audience window
      When the audience window is resized to 1200 by 400
      Then every preview has the audience window's shape
      When the audience window is resized to 600 by 800
      Then every preview has the audience window's shape
      And a screenshot "presenter-previews-tall" is saved

    @issue-25
    Scenario: A presenter page that connects late gets the display's shape at once
      When the audience window is resized to 1200 by 400
      And the presenter page is reloaded
      Then every preview has the audience window's shape

    @issue-25
    Scenario: Resizing the presenter page does not change the previews' shape
      When the audience window is resized to 1200 by 400
      And the presenter page is resized to 900 by 900
      Then every preview has the audience window's shape

  Rule: Without the audience window

    Background:
      Given the presenter page is open without its audience window

    @issue-25
    Scenario: Before the display reports, previews take the deck's shape
      Then every preview has the shape 16:9
