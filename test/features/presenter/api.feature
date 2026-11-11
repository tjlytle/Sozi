# covers: src/js/presenter.js, src/js/presenter/PresenterApi.js, src/js/presenter/panels.js, src/js/protocol/TransportSet.js, src/js/player/DisplayApi.js, src/js/player/DisplayChannel.js, src/js/Storage.js, src/templates/presenter.html, src/js/model/customFiles.js
Feature: Add-ons extend the presenter

  A deck's custom script can target the presenter page, the presentation page or both.
  A script on the presenter page finds window.sozi.presenter. A panel it registers docks,
  tabs and is remembered like a built-in one, and it follows the talk through the same
  events the built-in panels hear. A panel can also be a page the add-on points at.

  A script can add a transport. Commands then go to the transport added last, and what any
  transport reports moves the panels. A panel and a script on the presentation page can
  send each other messages of their own.

  A panel can carry a one-line description, which the + menu shows under its title.

  The "addons" deck has a presenter panel "Add-on", which shows the frame, has a "Ping"
  button and the description "A panel from the test add-on"; a url panel "Page"; a display
  script that answers a ping with a pong; and two marker scripts that say which page loaded
  them.

  Background:
    Given the "addons" deck is built
    And the presenter page is open

  @issue-27
  Scenario: A presenter add-on's panel joins the workspace and is remembered
    Then the workspace shows a panel "Add-on"
    And the "Add-on" panel reads "frame 1"
    When the next button is pressed
    Then the "Add-on" panel reads "frame 2"
    When the "Add-on" panel is dragged to the left of "Current"
    And the presenter page is reloaded
    Then the "Add-on" panel is to the left of "Current"
    And a screenshot "presenter-addon-panel" is saved

  @issue-27
  Scenario: A url panel renders the page it points at
    Then the workspace shows a panel "Page"
    And the "Page" panel's page reads "Hello from a page"

  @issue-27
  Scenario: A fake transport receives commands and drives the panels
    When a fake transport is registered on the presenter page
    And the key "End" is pressed on the presenter page
    Then the fake transport received "jumpToFrame" with index 1
    When the fake transport delivers a frame change to index 1
    Then the frame counter reads "2 / 2"
    And the notes title is "Two"
    And the "Add-on" panel reads "frame 2"

  @issue-27
  Scenario: A custom message goes from a panel to a display add-on and back
    When the "Ping" button in the "Add-on" panel is pressed
    Then the "Add-on" panel reads "pong"

  @issue-27
  Scenario: A panel registered after the page has loaded starts from the current frame
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    When a panel "Late" is registered from the console
    Then the "Late" panel reads "frame 2"

  @issue-27
  Scenario: A custom file loads only on the pages its target names
    Then the presenter page loaded the add-ons "marker.js"
    And the audience window loaded the add-ons "marker.js, marker-display.js"

  @issue-318
  Scenario: An add-on's panel is listed in the + menu with its description
    When the "Add-on" panel is closed from its menu
    Then the + menu lists "Add-on" described as "A panel from the test add-on"
