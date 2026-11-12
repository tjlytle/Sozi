# covers: src/js/protocol/drawings.js, src/js/protocol/strokes.js, src/js/protocol/hello.js, src/js/player/DrawingLayer.js, src/js/player/Viewport.js, src/js/player/DisplayChannel.js, src/js/player.js, src/js/presenter/DisplayMirror.js, src/js/presenter/panels/PreviewPanel.js, src/templates/player.html
Feature: Drawings on the audience window

  A speaker marks up the talk as it runs: a pen line under a word, a highlighter over a
  figure. The audience window holds the drawings, as it holds the frame and the camera, and
  any surface can change them with protocol messages. There is no drawing tool on the
  presenter page yet; these scenarios send the messages from a second surface.

  A stroke is drawn on the artwork, not on the glass: when the talk moves to another frame,
  the stroke moves with the shape it marks. It shows while it is still being drawn. Undo
  takes back the last finished stroke, erase removes one stroke, clear removes them all,
  and hide keeps them out of sight until show brings them back. The highlighter always sits
  under the pen, so a highlight never hides the line it marks.

  A surface that joins later gets every stroke when it says hello, and so do the previews
  on every presenter page. A stroke the display cannot trust, such as a colour that is not
  a plain `#rrggbb`, is refused and changes nothing.

  Background:
    Given the "basic" deck is built
    And the presenter page is open
    And a second surface is connected to the audience window

  @issue-520
  Scenario: A stroke stays on the artwork it marks when the talk moves on
    When the second surface draws a red pen stroke across "r1"
    Then the audience window shows 1 stroke
    And the stroke in the audience window lies over "r1"
    When the next button is pressed
    Then the audience window is on frame "Two"
    And the stroke in the audience window lies over "r1"
    And a screenshot "drawings-after-move" is saved

  @issue-520
  Scenario: A stroke shows while it is still being drawn
    When the second surface starts a red pen stroke across "r1" and does not finish it
    Then the audience window shows 1 stroke

  @issue-520
  Scenario: Undo, erase and clear each remove what they name
    When the second surface draws a red pen stroke across "r1"
    And the second surface draws a blue pen stroke across "r2"
    And the second surface draws a green pen stroke across "r1"
    And the second surface undoes
    Then the audience window shows 2 strokes
    When the second surface erases the blue stroke
    Then the audience window shows only the red stroke
    When the second surface clears the drawings
    Then the audience window shows 0 strokes

  @issue-520
  Scenario: Hide keeps the strokes and show brings them back
    When the second surface draws a red pen stroke across "r1"
    And the second surface hides the drawings
    Then the audience window shows no strokes
    When the second surface shows the drawings
    Then the audience window shows 1 stroke

  @issue-520
  Scenario: A surface that joins later gets the strokes, and so do its previews
    When the second surface draws a red pen stroke across "r1"
    And the second surface is reloaded
    Then the second surface's current-frame preview shows 1 stroke
    And the current-frame preview shows 1 stroke

  @issue-520
  Scenario: The highlighter sits under the pen even when drawn after it
    When the second surface draws a red pen stroke across "r1"
    And the second surface draws a yellow highlighter stroke across "r1"
    Then the highlighter stroke is painted under the pen stroke
    And a screenshot "drawings-highlighter" is saved

  @issue-520
  Scenario: A malformed stroke changes nothing
    When the second surface sends a pen stroke with the colour "red; fill: url(x)"
    Then the audience window shows 0 strokes
