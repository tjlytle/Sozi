# covers: src/js/protocol/camera.js, src/js/player/DisplayChannel.js, src/js/player/PreviewGestures.js, src/js/player/PreviewMode.js, src/js/presenter/panels/PreviewPanel.js, src/js/presenter/DisplayMirror.js, src/templates/presenter.html
Feature: Pan and zoom the audience window from the current-frame preview

  Sometimes the speaker wants to show a detail the frame does not frame: a corner of a
  diagram, a line of small print. On the presenter page the speaker drags the
  current-frame preview to pan, and turns the wheel or pinches to zoom. The audience
  window follows at once, by the same share of its size and about the same point, and the
  preview shows what the room sees.

  While the camera is off its frame, the preview shows a "Back to frame" button. The
  button, Next, Previous or any other frame change puts the camera back on a frame and
  hides the button again. Every surface connected to the talk sees the camera leave its
  frame and come back. A click that is not a drag still follows a link, as it did before,
  and a pan made with the mouse on the audience window itself shows on the presenter too.

  Rule: On the basic deck

    Background:
      Given the "basic" deck is built
      And the presenter page is open

    @issue-320
    Scenario: Dragging the current-frame preview pans the audience window by the same share
      When the current-frame preview is dragged 100 pixels to the left
      Then the audience window has panned by the same share of its width as the preview
      And the current-frame preview shows the audience window's view
      And the current-frame preview shows "Back to frame"
      And a screenshot "presenter-pan" is saved

    @issue-320
    Scenario: A drag at phone width pans the audience window the same way
      When the presenter page is resized to 390 by 844
      And the current-frame preview is dragged 100 pixels to the left
      Then the audience window has panned by the same share of its width as the preview

    @issue-320
    Scenario: The wheel over the preview zooms the audience window about the same point
      When the wheel turns up over the current-frame preview at its top-left quarter
      Then the audience window is zoomed in about the point at its top-left quarter
      And the current-frame preview shows the audience window's view

    @issue-320
    Scenario: A pinch on the preview zooms the audience window
      When two fingers spread apart on the current-frame preview
      Then the view is zoomed in on the audience window

    @issue-320
    Scenario: Back to frame returns the camera to the current frame
      When the current-frame preview is dragged 100 pixels to the left
      And "Back to frame" is pressed
      And the audience transition has finished
      Then the audience window's camera is on frame "One"
      And the frame counter reads "1 / 2"
      And the current-frame preview shows no "Back to frame"

    @issue-320
    Scenario: Next from an off-frame view lands on the next frame
      When the current-frame preview is dragged 100 pixels to the left
      And the next button is pressed
      And the audience transition has finished
      Then the audience window's camera is on frame "Two"
      And the current-frame preview shows no "Back to frame"

    @issue-320
    Scenario: Previous from an off-frame view lands on the previous frame
      When the next button is pressed
      And the audience transition has finished
      And the current-frame preview is dragged 100 pixels to the left
      And the previous button is pressed
      And the audience transition has finished
      Then the audience window's camera is on frame "One"
      And the current-frame preview shows no "Back to frame"

    @issue-320
    Scenario: A second surface sees the camera leave its frame and come back
      Given a second surface is connected to the audience window
      When the current-frame preview is dragged 100 pixels to the left
      Then the second surface's current-frame preview shows "Back to frame"
      When "Back to frame" is pressed on the second surface
      Then the current-frame preview shows no "Back to frame"

    @issue-320
    Scenario: A drag on the audience window itself shows on the presenter
      When the audience window's slide is dragged 100 pixels to the left
      Then the current-frame preview shows "Back to frame"

  Rule: On a deck with a link to another frame

    Background:
      Given the "links" deck is built
      And the presenter page is open

    @issue-320
    Scenario: A click on a link in the preview still follows it
      When the link "to-two" in the current-frame preview is clicked
      Then the audience window is on frame "Two"
      And the current-frame preview shows no "Back to frame"
