# covers: src/js/view/Properties.js, src/js/view/Preview.js, src/js/view/Toolbar.js, src/js/Controller.js, src/js/player/Camera.js
Feature: The properties panel in the editor

  The properties panel edits the selected frame and layers. A transition duration is
  typed in seconds and saved in milliseconds. The layer opacity shows at once in the
  preview and is saved with the frame. The toolbar's Undo takes an edit back, in the
  preview and in the panel.

  The editor opens the basic deck with its first frame and both layers selected.

  Background:
    Given the editor is open on a copy of the basic deck

  @issue-238
  Scenario: A transition duration typed in seconds is saved in milliseconds
    When the field "transitionDurationMs" is changed to "2.5"
    And the key "Control+S" is pressed in the editor
    Then the presentation file on disk has frame 1 with "transitionDurationMs" 2500

  @issue-238
  Scenario: The layer opacity shows in the preview and is saved
    When the field "opacity" is changed to "0.5"
    Then every layer in the preview has opacity "0.5"
    When the key "Control+S" is pressed in the editor
    Then the presentation file on disk has frame 1 with opacity 0.5 on every layer

  @issue-238
  Scenario: The toolbar's Undo puts the opacity back
    When the field "opacity" is changed to "0.5"
    And the toolbar button "Undo" is pressed
    Then every layer in the preview has opacity "1"
    And the field "opacity" reads "1"
