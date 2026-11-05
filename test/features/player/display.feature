# covers: src/templates/player.html, src/js/player.js, src/js/player/Player.js, src/js/player/FrameNumber.js, src/js/player/Camera.js, src/js/player/Viewport.js, src/js/svg/SVGDocumentWrapper.js
Feature: What the player shows and hides

  While a deck loads, the page is black with a spinner. Once it has loaded, the drawing
  shows and the spinner goes. The frame number sits in the corner, except on a frame
  that asks to hide it. An element the author marked hidden stays hidden. The "." key
  fades the page to black and back.

  The "visibility" deck has two frames, "One" and "Two"; frame "Two" hides the frame
  number. The circle "hideme" is in the deck's elements to hide. Its layers carry
  style="display:inline", the way Inkscape writes them. Every check reads the computed
  style, so it proves what a person sees, whatever sets it.

  Background:
    Given the "visibility" deck is built
    And the deck page is open

  @issue-240
  Scenario: The deck shows once loaded, without the spinner
    Then the deck is shown
    And the loading spinner is hidden
    And a screenshot "player-loaded" is saved

  @issue-240
  Scenario: The frame number hides on a frame that asks for it
    Then the frame number is shown
    When the key "ArrowRight" is pressed
    Then the player is on frame "Two"
    And the frame number is hidden

  @issue-240
  Scenario: An element marked hidden stays hidden in the player
    Then the element "hideme" is hidden

  @issue-240
  Scenario: The blank screen fades out and comes back
    When the key "." is pressed
    Then the page is blank
    When the key "." is pressed
    Then the page is not blank
    And a screenshot "player-unblanked" is saved
