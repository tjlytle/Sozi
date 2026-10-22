# covers: src/js/editor.js, src/js/Controller.js, src/js/Storage.js, src/js/backend/Electron.js, src/js/view/, src/js/model/
Feature: Opening a deck in the editor

  The editor is the Electron app in build/electron, launched by Playwright on a fresh
  copy of the basic deck with an isolated HOME. The window title is the title of the
  SVG document ("Basic"), not the file name.

  Background:
    Given the editor is open on a copy of the basic deck

  @issue-36
  Scenario: The timeline lists the frames and the first is selected
    Then the timeline shows 2 frames
    And the selected frame's title field reads "One"
    And the window title contains "Basic"
