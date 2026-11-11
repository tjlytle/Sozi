# covers: docs/presenter-addons.md, src/js/presenter/PresenterApi.js, src/js/presenter/panels.js, test/features/support/docExample.js
Feature: The guide to writing a presenter panel works as written

  A person who wants to add a panel to the presenter reads docs/presenter-addons.md and
  does not open the source. The guide ends with a worked example: a "Frame count" panel
  that shows the current frame's title and how many times that frame has been shown. They
  save its script beside their deck, add it to the deck's custom files, build the deck
  with the CLI and open the presenter page.

  These scenarios do exactly that with the code blocks of the guide itself, in a copy of
  the "basic" deck (frames "One" and "Two"), so the guide cannot drift from what works.
  The panel is in the + menu with its description, and closing and reopening it does not
  make it count a frame change twice.

  @issue-415
  Scenario: The guide's worked example adds a panel that follows the talk
    Given the "basic" deck is built with the worked example of "docs/presenter-addons.md"
    And the presenter page is open
    Then the workspace shows a panel "Frame count"
    And the "Frame count" panel reads "One, shown 1 time"
    When the next button is pressed
    Then the "Frame count" panel reads "Two, shown 1 time"
    When the previous button is pressed
    Then the "Frame count" panel reads "One, shown 2 times"
    And a screenshot "presenter-addon-guide-example" is saved

  @issue-415
  Scenario: The guide's example is listed in the + menu and counts once after it is reopened
    Given the "basic" deck is built with the worked example of "docs/presenter-addons.md"
    And the presenter page is open
    When the "Frame count" panel is closed from its menu
    Then the + menu lists "Frame count" described as "How often each frame has been shown"
    When "Frame count" is added from the + menu
    And the next button is pressed
    Then the "Frame count" panel reads "Two, shown 1 time"
