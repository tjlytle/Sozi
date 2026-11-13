# covers: src/js/protocol/drawings.js, src/js/protocol/strokes.js, src/js/protocol/hello.js, src/js/player/DrawingLayer.js, src/js/player/Viewport.js, src/js/player/DisplayChannel.js, src/js/player.js, src/js/presenter/DisplayMirror.js, src/js/presenter/panels/PreviewPanel.js, src/templates/player.html, src/js/player/PreviewPen.js, src/js/player/PreviewMode.js, src/js/presenter/DrawingToolbar.js, src/js/presenter/Workspace.js, src/js/presenter/panels.js, src/css/presenter/drawing-toolbar.css, src/js/protocol/strokeOutline.js, src/js/protocol/canvas.js, src/js/svg/SVGDocumentWrapper.js, src/js/presenter/drawingsSvg.js, src/js/presenter/Downloads.js
Feature: Drawings on the audience window

  A speaker marks up the talk as it runs: a pen line under a word, a highlighter over a
  figure. The audience window holds the drawings, as it holds the frame and the camera, and
  any surface can change them with protocol messages, sent here from a second surface.

  A stroke is drawn on the artwork, not on the glass: when the talk moves to another frame,
  the stroke moves with the shape it marks. It shows while it is still being drawn. Undo
  takes back the last finished stroke, erase removes one stroke, clear removes them all,
  and hide keeps them out of sight until show brings them back. The highlighter always sits
  under the pen, so a highlight never hides the line it marks.

  A surface that joins later gets every stroke when it says hello, and so do the previews
  on every presenter page. A stroke the display cannot trust, such as a colour that is not
  a plain `#rrggbb`, is refused and changes nothing.

  On the presenter page the speaker draws on the current-frame preview. Its toolbar holds a
  pen, a highlighter, an eraser, four colours, Undo, Clear, Hide or Show, a Draw toggle and
  Maximise. With Draw on, a drag with the mouse or a finger draws; with it off, the same drag
  pans the audience window as before. A stylus always draws, so one hand draws while a finger
  pans. The room sees the stroke as it is drawn, on a small preview, a maximised one or a
  phone. A click on the toolbar does not take the talk's keys.

  After the talk the speaker can keep what was drawn. Export saves the drawings as one SVG
  file with one layer, in the deck's own canvas: it opens alone, and pasted in place over the
  deck in Inkscape every stroke sits on the artwork it marked. Hidden drawings are saved too,
  a highlight keeps its colour and its see-through look, and with nothing drawn there is
  nothing to export. The export never writes to the deck's own files.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  Rule: Any surface changes the drawings with protocol messages

    Background:
      Given a second surface is connected to the audience window

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

  Rule: The speaker draws on the current-frame preview

    @issue-521
    Scenario: In draw mode a drag on the preview draws on the audience window
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      Then the audience window shows 1 stroke
      And the stroke in the audience window lies over "r1"
      And the audience window's camera is on frame "One"
      And a screenshot "draw-preview-pen" is saved

    @issue-521
    Scenario: In pan mode the same drag pans and draws nothing
      Given the "Current" panel's toolbar is in pan mode
      When the current-frame preview is dragged 100 pixels to the left
      Then the audience window has panned by the same share of its width as the preview
      And the audience window shows 0 strokes

    @issue-521
    Scenario: A stylus draws even in pan mode
      Given the "Current" panel's toolbar is in pan mode
      When a stylus drags across "r1" on the current-frame preview with rising pressure
      Then the audience window shows 1 stroke
      And the audience window's camera is on frame "One"

    @issue-521
    Scenario: Undo, Clear and Hide from the toolbar change the audience window
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across the top of "r1" on the current-frame preview
      And a mouse drags across the bottom of "r1" on the current-frame preview
      And the "Undo" button in the "Current" panel is pressed
      Then the audience window shows 1 stroke
      When the "Hide drawings" button in the "Current" panel is pressed
      Then the audience window shows no strokes
      When the "Show drawings" button in the "Current" panel is pressed
      Then the audience window shows 1 stroke
      When the "Clear" button in the "Current" panel is pressed
      Then the audience window shows 0 strokes

    @issue-521
    Scenario: The eraser removes the stroke it passes over
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across the top of "r1" on the current-frame preview
      And a mouse drags across the bottom of "r1" on the current-frame preview
      And the "Eraser" button in the "Current" panel is pressed
      And a mouse drags across the bottom of "r1" on the current-frame preview
      Then the audience window shows 1 stroke
      And the stroke in the audience window lies over the top of "r1"

    @issue-521
    Scenario: Maximise from the toolbar, draw, then Restore
      When the "Maximise" button in the "Current" panel is pressed
      Then the "Current" panel fills the workspace
      And the "Current" panel's toolbar shows "Restore"
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      Then the audience window shows 1 stroke
      And a screenshot "draw-preview-maximised" is saved
      When the "Restore" button in the "Current" panel is pressed
      Then the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

    @issue-521
    Scenario: A key after a toolbar click still moves the talk
      When the "Draw" button in the "Current" panel is pressed
      And the key "Space" is pressed on the presenter page
      Then the audience window is on frame "Two"

    @issue-521
    Scenario: Drawing on a phone-sized presenter
      When the presenter page is opened on a phone at 390 by 844
      And the "Draw" button in the "Current" panel is pressed
      And a finger drags across "r1" on the current-frame preview
      Then the audience window shows 1 stroke
      And a screenshot "draw-preview-phone" is saved

  Rule: The speaker keeps the drawings as an SVG layer

    @issue-522
    Scenario: Export saves the drawings as one SVG layer that lines up with the deck
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      And the "Export" button in the "Current" panel is pressed
      Then the file "basic-drawings.svg" is saved
      And the saved file holds 1 path in 1 layer
      And the saved file has the viewBox "0 0 800 600", the width "800" and the height "600"
      And the saved path lies over "r1" of "basic.svg"
      And a screenshot "drawings-export" is saved

    @issue-522
    Scenario: Hidden drawings are exported too
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      And a mouse drags across "r2" on the current-frame preview
      And the "Hide drawings" button in the "Current" panel is pressed
      And the "Export" button in the "Current" panel is pressed
      Then the saved file holds 2 paths in 1 layer

    @issue-522
    Scenario: The highlighter keeps its colour and opacity in the file
      When the "Draw" button in the "Current" panel is pressed
      And the "Highlighter" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      And the "Export" button in the "Current" panel is pressed
      Then the saved path has the fill and opacity of the highlighter stroke in the audience window

    @issue-522
    Scenario: With no drawings there is nothing to export
      Then the "Export" button in the "Current" panel is disabled
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      Then the "Export" button in the "Current" panel is enabled
      When the "Clear" button in the "Current" panel is pressed
      Then the "Export" button in the "Current" panel is disabled

    @issue-522
    Scenario: Export leaves the deck's files as they were
      When the "Draw" button in the "Current" panel is pressed
      And a mouse drags across "r1" on the current-frame preview
      And the "Export" button in the "Current" panel is pressed
      Then the deck's ".svg", ".sozi.json" and ".sozi.html" files are unchanged
