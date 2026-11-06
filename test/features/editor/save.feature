# covers: src/js/editor.js, src/js/Controller.js, src/js/Storage.js, src/js/backend/Electron.js, src/js/view/, src/js/model/
Feature: Saving a deck from the editor

  Ctrl+S writes the presentation file (.sozi.json) and the player page (.sozi.html)
  next to the SVG document. A custom file's target is saved with the file's path.

  @issue-36
  Scenario: A title edited in the editor is written to disk by Ctrl+S
    Given the editor is open on a copy of the basic deck
    When the title field is changed to "Uno"
    And the key "Control+S" is pressed in the editor
    Then the presentation file on disk has frame 1 titled "Uno"
    And the presentation HTML file on disk contains "Uno"

  @issue-27
  Scenario: A custom file's target chosen in the editor is saved
    Given the editor is open on a copy of the "addons" deck
    When the target of custom file "marker-display.js" is set to "presenter"
    And the key "Control+S" is pressed in the editor
    Then the presentation file on disk lists "marker-display.js" with target "presenter"
