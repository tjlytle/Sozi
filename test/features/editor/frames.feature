# covers: src/js/editor.js, src/js/Controller.js, src/js/Storage.js, src/js/backend/Electron.js, src/js/view/, src/js/model/
Feature: Editing frames in the editor

  The timeline lists the frames: one cell per frame for the number and one for the title.
  These scenarios select, add, delete and reorder frames through the timeline buttons and
  the keyboard, and undo a title edit. Reordering goes through the "insert selection
  before frame N" icon of the timeline, which calls Controller.moveFrames like a drop.
  Not covered: timeline drag.

  Background:
    Given the editor is open on a copy of the basic deck

  @issue-36
  Scenario: Clicking a frame in the timeline selects it and shows its title
    When frame 2 is clicked in the timeline
    Then frame 2 is the selected frame
    And the selected frame's title field reads "Two"

  @issue-36
  Scenario: The arrow keys move the selection along the timeline
    When the key "ArrowRight" is pressed in the editor
    Then frame 2 is the selected frame
    When the key "Home" is pressed in the editor
    Then frame 1 is the selected frame

  @issue-36
  Scenario: A frame added with the toolbar button can be deleted again
    When the toolbar button "Create a new frame" is pressed
    Then the timeline shows 3 frames
    And frame 2 is the selected frame
    When the toolbar button "Delete the selected frames" is pressed
    Then the timeline shows 2 frames
    And the timeline titles are "One, Two"
    And no frame is selected

  @issue-36
  Scenario: A frame added with Ctrl+N can be deleted with the Delete key
    When the key "Control+N" is pressed in the editor
    Then the timeline shows 3 frames
    When the key "Delete" is pressed in the editor
    Then the timeline shows 2 frames
    And the timeline titles are "One, Two"

  @issue-36
  Scenario: Undo after a title edit restores the title
    When the title field is changed to "Changed"
    Then the timeline titles are "Changed, Two"
    When the key "Control+Z" is pressed in the editor
    Then the timeline titles are "One, Two"
    And the selected frame's title field reads "One"

  @issue-36
  Scenario: Inserting the selection before the first frame reorders the frames
    When frame 2 is clicked in the timeline
    And the selection is inserted before frame 1
    Then the timeline titles are "Two, One"
