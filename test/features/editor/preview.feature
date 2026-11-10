# covers: src/js/model/Presentation.js, src/js/svg/authorStyle.js, src/css/sozi.editor.view.Preview.css
Feature: Layers in the editor's preview

  The eye in a layer's row of the timeline hides that layer in the preview, and a
  second click shows it again. It works on a layer drawn in Inkscape, which writes
  style="display:inline" on every layer group: the author's own inline style must not
  keep a hidden layer on screen.

  The "visibility" deck has two layers, "Layer 1" and "Layer 2", both with
  style="display:inline"; "Layer 1" has its own row in the timeline.

  @issue-240
  Scenario: The eye toggle hides an Inkscape layer that carries an inline display
    Given the editor is open on a copy of the "visibility" deck
    When the layer "Layer 1" is hidden in the timeline
    Then the layer "Layer 1" is not displayed in the preview
    When the layer "Layer 1" is shown in the timeline
    Then the layer "Layer 1" is displayed in the preview
    And a screenshot "editor-layer-shown" is saved
