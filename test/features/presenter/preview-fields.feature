# covers: src/js/player/PreviewMode.js, src/js/protocol/editable.js, src/js/presenter.js
Feature: Fields a person types into inside a preview

  A deck can hold a field a person types into: a text input, or editable content, in an
  SVG foreignObject. When the speaker clicks into such a field in a presenter preview and
  types, the characters go into the field. Space, Enter, the arrows and "." stay in the
  field: the audience window and the frame counter stay where they were.

  Once the focus leaves the field for the rest of the preview, the keys move the display
  again, as they do whenever a preview has the focus. What counts as a field is the rule
  the presenter page already applies to its own fields.

  The "editable" deck is the "basic" deck with an input "answer" and editable content
  "scratch" in the top-left corner of frame One, away from the preview's centre.

  Background:
    Given the "editable" deck is built
    And the presenter page is open

  @issue-280
  Scenario: Keys typed into a text field in a preview stay in the field
    When the field "answer" in the "Current" preview is clicked
    And the text "a b." is typed on the presenter page
    And the key "Enter" is pressed on the presenter page
    And the key "ArrowRight" is pressed on the presenter page
    Then the field "answer" in the "Current" preview reads "a b."
    And the frame counter reads "1 / 2"
    And the audience window is on frame "One"

  @issue-280
  Scenario: Keys typed into editable content in a preview stay in it
    When the field "scratch" in the "Current" preview is clicked
    And the text "x y" is typed on the presenter page
    Then the field "scratch" in the "Current" preview reads "x y"
    And the frame counter reads "1 / 2"
    And the audience window is on frame "One"

  @issue-280
  Scenario: Keys move the display again once the focus leaves the field
    When the field "answer" in the "Current" preview is clicked
    And the "Current" preview is clicked
    And the key " " is pressed on the presenter page
    Then the frame counter reads "2 / 2"
    And the audience window is on frame "Two"
