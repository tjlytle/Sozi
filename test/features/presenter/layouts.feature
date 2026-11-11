# covers: src/js/presenter.js, src/js/presenter/Workspace.js, src/js/presenter/WorkspaceBar.js, src/js/presenter/PanelMenu.js, src/js/presenter/Menu.js, src/js/presenter/PresetForm.js, src/js/presenter/DisplayMirror.js, src/js/player/DisplayChannel.js, src/js/model/Presentation.js, src/js/protocol/messages.js, src/templates/presenter.html
Feature: A deck carries named layouts for the presenter

  A deck can carry named layouts, each for a width: one for a phone, one for a laptop, one
  for a page at least so many pixels wide. A device that has never seen the deck opens on the
  first one that matches, in the deck's order, and the panels it leaves out wait in the +
  menu. The Layouts menu lists the deck's presets for this width and Default; choosing one
  shows it and saves it for this width, like any arrangement the speaker makes.

  What the speaker arranges on this device wins over the deck, each width keeps its own
  arrangement, and Reset layout goes back to the deck's. Opening on a preset saves nothing, so
  a preset the deck changes later still reaches a device that has not rearranged anything. A
  preset this surface cannot use is skipped, and the page says so.

  Save as preset turns the current arrangement into a file and says what to run to put it in
  the deck. The deck has to be built again before a device can read it.

  Background:
    Given the "layouts" deck is built

  @issue-33
  Scenario: A phone that has never seen the deck opens on the phone preset
    Given the presenter page is open at 390 by 844
    Then the "Current" panel is above "Notes"
    And the + menu lists "Previous, Next, Controls, Connection"
    And a screenshot "presenter-preset-phone" is saved

  @issue-33
  Scenario: The same deck opens on the laptop preset on a laptop
    Given the presenter page is open at 1280 by 800
    Then the "Notes" panel is to the left of "Current"
    And a screenshot "presenter-preset-laptop" is saved

  @issue-33
  Scenario: The first preset that matches wins
    Given the presenter page is open at 1920 by 1080
    Then the "Next" panel is to the left of "Current"

  @issue-33
  Scenario: A rearrangement on the phone survives a reload and reset returns to the preset
    Given the presenter page is open at 390 by 844
    When the "Notes" panel is dragged to the left of "Current"
    And the presenter page is reloaded
    Then the "Notes" panel is to the left of "Current"
    When the layout is reset
    Then the "Current" panel is above "Notes"
    When the presenter page is reloaded
    Then the "Current" panel is above "Notes"

  @issue-33
  Scenario: A saved layout wins over the preset
    Given the presenter page is open at 1280 by 800
    Then the "Notes" panel is to the left of "Current"
    When the "Current" panel is dragged to the left of "Notes"
    And the presenter page is reloaded
    Then the "Current" panel is to the left of "Notes"

  @issue-33
  Scenario: Opening on a preset saves nothing
    Given the presenter page is open at 1280 by 800
    Then the "Notes" panel is to the left of "Current"
    And no layout is saved for the deck

  @issue-33
  Scenario: Each width keeps its own layout
    Given the presenter page is open at 1280 by 800
    When the "Current" panel is dragged to the left of "Notes"
    And the presenter page is resized to 390 by 844
    Then the "Current" panel is above "Notes"
    When the presenter page is resized to 1280 by 800
    Then the "Current" panel is to the left of "Notes"

  @issue-33
  Scenario: Moving to a preset keeps the talk where it is
    Given the presenter page is open at 390 by 844
    When "Controls" is added from the + menu
    And the next button is pressed
    Then the frame counter reads "2 / 2"
    And the notes title is "Two"
    And the "Current" preview shows frame "Two"

  @issue-33
  Scenario: A preset this surface cannot use gives the default layout and says so
    Given the "layouts-unknown-panel" deck is built
    And the presenter page is open at 1280 by 800
    Then the "Current" panel is to the left of "Notes"
    And the presenter page says the preset "laptop" could not be used

  @issue-33
  Scenario: A deck with no presets opens as before
    Given the "basic" deck is built
    And the presenter page is open at 390 by 844
    Then the panels are tabs "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

  @issue-33
  Scenario: Save as preset downloads the layout and says what to do next
    Given the presenter page is open at 1280 by 800
    When the "Current" panel is dragged to the left of "Notes"
    And the layout is saved as the preset "mine" for "laptop"
    Then the file "layouts.mine.layout.json" is downloaded
    And the presenter page says to run "--layout mine=layouts.mine.layout.json"
    And a screenshot "presenter-save-preset" is saved

  @issue-33
  Scenario: Typing a preset's name does not move the talk
    Given the presenter page is open at 1280 by 800
    When the preset form is opened
    And "my talk" is typed as the preset's name
    Then the frame counter reads "1 / 2"

  @issue-33
  Scenario: A saved preset opens on a device that has never seen the deck
    Given the presenter page is open at 1280 by 800
    When the "Current" panel is dragged to the left of "Notes"
    And the layout is saved as the preset "mine" for "laptop"
    And the downloaded preset is added to the deck with the CLI ahead of the others
    And the deck is built again
    And the presenter page is opened on a new device at 1280 by 800
    Then the "Current" panel is to the left of "Notes"

  @issue-318
  Scenario: The Layouts menu shows a preset and Default
    Given the presenter page is open at 1280 by 800
    When the layout "Default" is chosen from the Layouts menu
    Then the "Current" panel is to the left of "Notes"
    When the layout "laptop" is chosen from the Layouts menu
    Then the "Notes" panel is to the left of "Current"

  @issue-291
  Scenario: A saved layout dockview refuses gives way to the preset
    Given the presenter page is open at 1280 by 800
    And the saved layout for the deck is "{\"version\":1,\"dock\":{\"grid\":{},\"panels\":{}},\"rail\":[]}"
    When the presenter page is reloaded
    Then the "Notes" panel is to the left of "Current"
