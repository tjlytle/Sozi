# covers: src/js/presenter/panels/ClockPanel.js, src/js/presenter/clock.js, src/js/presenter/DisplayMirror.js, src/js/presenter/PresenterApi.js, src/js/presenter/Workspace.js, src/js/presenter.js, src/js/player/TalkTimer.js, src/js/player/DisplayChannel.js, src/js/player.js, src/js/protocol/timer.js, src/js/protocol/messages.js, src/templates/presenter.html
Feature: The clock, the elapsed timer and the frame counter

  The speaker wants to know three things at a glance: what time it is, how long the talk has
  been running, and how far through the deck it is. The Clock panel shows all three, the
  elapsed time largest of all, so that it can be read at phone size and from a laptop across a
  lectern.

  The timer starts by itself on the first frame change, or earlier with Start. Pause holds it,
  and a frame change does not restart a paused timer. Reset returns it to 00:00, and the next
  frame change starts it again.

  With a target length set, the panel says how much is left, then how much is over. The digits
  change to a quiet colour from 80% of the target and to a second colour past it. Nothing
  blinks.

  The display owns the timer, so every surface shows the same time, and one that joins or
  reloads is right straight away. If the display goes away, the panel stops counting and
  disables its controls.

  These scenarios move the pages' clocks on instead of waiting. "About" means within 2 seconds,
  with the real time the scenario took on top, because the clocks keep running between steps.

  Background:
    Given the "basic" deck is built
    And the clocks of this scenario's pages can be moved on
    And the presenter page is open

  @issue-32
  Scenario: The panel shows the time of day, the elapsed time and the frame
    Then the workspace shows a panel "Clock"
    And the clock shows the time of day
    And the elapsed time reads "00:00"
    And the clock's frame reads "1 / 2"

  @issue-32
  Scenario: The first frame change starts the timer
    When the clocks move on by 1 minute
    Then the elapsed time reads "00:00"
    When the next button is pressed
    And the clocks move on by 2 minutes
    Then the elapsed time reads about "02:00"
    And the clock's frame reads "2 / 2"

  @issue-32
  Scenario: Start, pause and reset
    When the clock's "Start" button is pressed
    And the clocks move on by 1 minute
    And the clock's "Pause" button is pressed
    And the next button is pressed
    And the clocks move on by 5 minutes
    Then the elapsed time reads about "01:00"
    When the clock's "Reset" button is pressed
    Then the elapsed time reads "00:00"
    When the previous button is pressed
    And the clocks move on by 1 minute
    Then the elapsed time reads about "01:00"

  @issue-32
  Scenario: Two surfaces show the same time, and reconnecting one does not reset it
    Given a second surface is connected to the audience window
    When the next button is pressed
    And the clocks move on by 3 minutes
    Then both surfaces read the same elapsed time, within a second
    When the second surface is reloaded
    Then both surfaces read the same elapsed time, within a second
    And the elapsed time reads about "03:00"
    When the clock's "Pause" button is pressed
    Then the second surface's clock is paused

  @issue-32
  Scenario: Reloading the presenter page keeps the timer and the talk's place
    When the next button is pressed
    And the clocks move on by 3 minutes
    And the presenter page is reloaded
    Then the elapsed time reads about "03:00"
    And the audience window is on frame "Two"

  @issue-32
  Scenario: The digits shift colour quietly as the target nears, and nothing blinks
    When the clock's target is set to 20 minutes
    And the next button is pressed
    And the clocks move on by 10 minutes
    Then the clock is in its normal colour
    When the clocks move on by 6 minutes
    Then the clock is in its near colour
    And the clock's remaining time reads about "04:00 left"
    And a screenshot "presenter-clock-near" is saved
    When the clocks move on by 5 minutes
    Then the clock is in its over colour
    And the clock's remaining time reads about "01:00 over"
    And nothing in the clock panel is animated

  @issue-32
  Scenario: Clearing the target goes back to the normal colour
    When the clock's target is set to 1 minute
    And the next button is pressed
    And the clocks move on by 2 minutes
    And the clock's target is cleared
    Then the clock is in its normal colour

  @issue-32
  Scenario: Keys typed into the target field do not move the talk
    When "5" and Enter are typed into the clock's target field
    Then the audience window is on frame "One"
    And the clock's target is 5 minutes

  @issue-316
  Scenario: A target too long to time goes back to the target there was
    When the clock's target is set to 5 minutes
    And a target of 305 nines is entered in the clock's target field
    Then the clock's target is 5 minutes

  @issue-316
  Scenario: A target too long to time with no target set leaves the field empty
    When a target of 305 nines is entered in the clock's target field
    Then the clock has no target

  @issue-32
  Scenario Outline: The elapsed time is readable at <width> by <height>
    When the presenter page is resized to <width> by <height>
    And the "Clock" panel is shown
    Then the elapsed time is at least 48 pixels tall and fits its panel
    And a screenshot "<shot>" is saved

    Examples:
      | width | height | shot                   |
      | 390   | 844    | presenter-clock-phone  |
      | 1280  | 800    | presenter-clock-laptop |

  @issue-32
  Scenario: The panel stops counting when the audience window is gone
    When the next button is pressed
    And the audience window is closed
    Then the elapsed time stops changing
    And the clock's buttons are disabled

  @issue-32
  Scenario: A layout saved before the clock existed still gets the clock
    Given the saved layout for the deck has no "Clock" panel
    When the presenter page is reloaded
    Then the workspace shows a panel "Clock"
