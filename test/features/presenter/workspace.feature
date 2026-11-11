# covers: src/js/presenter.js, src/js/presenter/Workspace.js, src/js/presenter/WorkspaceBar.js, src/js/presenter/PanelMenu.js, src/js/presenter/Menu.js, src/js/presenter/DisplayMirror.js, src/js/presenter/panels/PreviewPanel.js, src/js/presenter/panels/NotesPanel.js, src/js/presenter/panels/ControlsPanel.js, src/js/presenter/panels/ConnectionPanel.js, src/js/player/PreviewMode.js, src/js/protocol/messages.js, src/templates/presenter.html
Feature: The presenter arranges a workspace of panels

  The presenter page opens as a workspace of eight panels: Current, Previous, Next, Notes, Frames,
  Clock, Controls and Connection. The speaker arranges it the way a video editor arranges its
  panels: drag a tab to dock it somewhere else, drag a splitter to resize, maximise one to fill the
  workspace. The arrangement is saved for this deck on this device and comes back on reload, and
  Reset layout brings back the default.

  Everything a drag does, the menus do too. The bar on the left edge has + Add panel, which
  lists the panels that are not showing, and each group header has a ⋯ menu to replace its
  panel, split beside it, maximise it, pop it out into a window of its own or close it.
  Close is not offered on the last panel showing, so the workspace never empties. A drag
  shows its drop targets as tinted, outlined areas, large enough to hit.

  On a page narrower than 600 px the same panels are one stack of tabs, with the same state
  in them. Widening the page brings back the saved layout. A phone lays the page out at its
  own width, so a phone held upright gets the stack and one held sideways gets the panels.

  The presentation keys move the display whichever panel has the focus, a preview included.

  The page is exactly as tall as its window in every layout and never scrolls under the
  workspace, so the bar on the left edge and the panels' toolbars stay on screen. Bringing something in a
  panel into view scrolls that panel only.

  Background:
    Given the "basic" deck is built
    And the presenter page is open

  @issue-26
  Scenario: The presenter opens on the default workspace
    Then the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"
    And the "Connection" panel reads "Connected"
    And a screenshot "presenter-workspace-default" is saved

  @issue-26
  Scenario: A layout the presenter arranged comes back on reload
    When the "Notes" panel is dragged to the left of "Current"
    And the "Notes" panel is resized to 300 pixels wide
    And the presenter page is reloaded
    Then the "Notes" panel is to the left of "Current"
    And the "Notes" panel is 300 pixels wide
    And a screenshot "presenter-workspace-moved" is saved

  @issue-26
  Scenario: A closed panel waits in the + menu and comes back
    When the "Next" panel is closed from its menu
    Then the workspace does not show a panel "Next"
    And the + menu lists "Next"
    When "Next" is added from the + menu
    Then the workspace shows a panel "Next"
    And the + menu lists nothing

  @issue-26
  Scenario: Maximise fills the workspace with one panel and restores it
    When the "Current" panel is maximised
    Then the "Current" panel fills the workspace
    When the "Current" panel is maximised
    Then the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

  @issue-26
  Scenario: Reset brings back the default layout
    When the "Notes" panel is dragged to the left of "Current"
    And the "Next" panel is closed from its menu
    And the layout is reset
    And the presenter page is reloaded
    Then the "Current" panel is to the left of "Notes"
    And the + menu lists nothing

  @issue-26
  Scenario: Keys move the display while a preview has the focus
    When the "Current" preview is clicked
    And the key " " is pressed on the presenter page
    Then the frame counter reads "2 / 2"
    And the audience window is on frame "Two"

  @issue-26
  Scenario: A saved layout that cannot be read gives the default layout
    Given the saved layout for the deck is "{not json"
    When the presenter page is reloaded
    Then the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

  @issue-26
  Scenario: On a phone-width page the panels are tabs that keep their state
    When the presenter page is resized to 390 by 844
    Then the panels are tabs "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"
    When the "Controls" tab is chosen
    And the next button is pressed
    And the "Notes" tab is chosen
    Then the notes title is "Two"
    When the "Current" tab is chosen
    Then the "Current" preview shows frame "Two"
    And a screenshot "presenter-workspace-phone" is saved

  @issue-302
  Scenario: On a phone the presenter page is laid out at the phone's width
    When the presenter page is opened on a phone at 390 by 844
    Then the presenter page is laid out 390 pixels wide
    And the panels are tabs "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"
    And a screenshot "presenter-phone-stack" is saved

  @issue-302
  Scenario: A phone held sideways gets the workspace of panels
    When the presenter page is opened on a phone at 844 by 390
    Then the presenter page is laid out 844 pixels wide
    And the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

  @issue-26
  Scenario: Widening the page brings back the saved layout
    When the "Notes" panel is dragged to the left of "Current"
    And the presenter page is resized to 390 by 844
    And the presenter page is resized to 1280 by 800
    Then the "Notes" panel is to the left of "Current"

  @issue-26
  Scenario: The connection panel shows when the audience window is gone
    When the audience window is closed
    Then the "Connection" panel reads "Closed"

  @issue-318
  Scenario: A speaker arranges the workspace without dragging
    Given the "Clock" panel is closed from its menu
    When "Clock" is added from the + menu
    And "Notes" is split right of "Current" from the panel menu
    And the "Next" panel is closed from its menu
    Then the workspace shows a panel "Clock"
    And the "Current" panel is to the left of "Notes"
    And the workspace does not show a panel "Next"
    And a screenshot "presenter-workspace-menus" is saved

  @issue-318
  Scenario: The + menu lists exactly the panels that are not showing
    When the "Next" panel is closed from its menu
    And the "Clock" panel is closed from its menu
    Then the + menu lists "Clock, Next"
    And a screenshot "presenter-add-panel-menu" is saved
    When "Next" is added from the + menu
    Then the + menu lists "Clock"

  @issue-318
  Scenario: A layout arranged through the menus comes back on reload
    When "Notes" is split right of "Current" from the panel menu
    And the "Next" panel is closed from its menu
    And the presenter page is reloaded
    Then the "Current" panel is to the left of "Notes"
    And the + menu lists "Next"

  @issue-318
  Scenario: Replace with puts another panel in a panel's place
    When "Clock" replaces "Previous" from the panel menu
    Then the workspace shows a panel "Clock"
    And the + menu lists "Previous"

  @issue-318
  Scenario: The last panel showing cannot be closed
    When every panel but "Current" is closed from its menu
    Then "Close" is disabled in the "Current" panel's menu

  @issue-318
  Scenario: On a phone the + menu adds a tab
    When the presenter page is resized to 390 by 844
    And the "Clock" panel is closed from its menu
    Then the panels are tabs "Current, Previous, Next, Notes, Frames, Controls, Connection"
    When "Clock" is added from the + menu
    Then the panels are tabs "Current, Previous, Next, Notes, Frames, Controls, Connection, Clock"
    And a screenshot "presenter-add-panel-phone" is saved

  @issue-318
  Scenario: Drop targets show once a drag starts
    When a drag of the "Notes" tab starts over "Current"
    Then the drop targets are visible
    And a screenshot "presenter-drop-targets" is saved

  @issue-318
  Scenario: Pop out moves a panel into its own window
    When the "Notes" panel is popped out from its menu
    Then the "Notes" panel is in a window of its own
    When the popped-out window is closed
    Then the workspace shows a panel "Notes"

  @issue-286
  Scenario: The page is as tall as its window with a tab behind another
    When the presenter page is resized to 1280 by 800
    Then the presenter page is as tall as its window

  @issue-286
  Scenario: Bringing a hidden panel into view leaves the workspace in place
    When the presenter page is resized to 1280 by 800
    And the "Connection" panel is scrolled into view
    Then the presenter page is not scrolled
    And a screenshot "presenter-workspace-not-scrolled" is saved

  @issue-286
  Scenario: A maximised panel leaves the page as tall as its window
    When the "Current" panel is maximised
    Then the presenter page is as tall as its window

  @issue-286
  Scenario: The phone-width stack is as tall as its window
    When the presenter page is resized to 390 by 844
    Then the presenter page is as tall as its window
