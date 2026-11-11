# covers: src/js/presenter.js, src/js/presenter/Workspace.js, src/js/presenter/Rail.js, src/js/presenter/DisplayMirror.js, src/js/presenter/panels/PreviewPanel.js, src/js/presenter/panels/NotesPanel.js, src/js/presenter/panels/ControlsPanel.js, src/js/presenter/panels/ConnectionPanel.js, src/js/player/PreviewMode.js, src/js/protocol/messages.js, src/templates/presenter.html
Feature: The presenter arranges a workspace of panels

  The presenter page opens as a workspace of six panels: Current, Previous, Next, Notes,
  Controls and Connection. The speaker arranges it the way a video editor arranges its
  panels: drag a tab to dock it somewhere else, drag a splitter to resize, minimise a panel
  to the rail on the left edge, maximise one to fill the workspace. The arrangement is
  saved for this deck on this device and comes back on reload, and Reset layout brings back
  the default.

  On a page narrower than 600 px the same panels are one stack of tabs, with the same state
  in them. Widening the page brings back the saved layout.

  The presentation keys move the display whichever panel has the focus, a preview included.

  The page is exactly as tall as its window in every layout and never scrolls under the
  workspace, so the rail and the panels' toolbars stay on screen. Bringing something in a
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
  Scenario: A minimised panel waits on the rail and comes back
    When the "Next" panel is minimised
    Then the workspace does not show a panel "Next"
    And the rail shows "Next"
    When the "Next" icon on the rail is clicked
    Then the workspace shows a panel "Next"
    And the rail is empty

  @issue-26
  Scenario: Maximise fills the workspace with one panel and restores it
    When the "Current" panel is maximised
    Then the "Current" panel fills the workspace
    When the "Current" panel is maximised
    Then the workspace shows the panels "Current, Previous, Next, Notes, Frames, Clock, Controls, Connection"

  @issue-26
  Scenario: Reset brings back the default layout
    When the "Notes" panel is dragged to the left of "Current"
    And the "Next" panel is minimised
    And the layout is reset
    And the presenter page is reloaded
    Then the "Current" panel is to the left of "Notes"
    And the rail is empty

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
