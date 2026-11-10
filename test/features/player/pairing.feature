# covers: src/js/player.js, src/js/player/DisplayApi.js, src/js/player/PairingOverlay.js, src/templates/player.html
Feature: An add-on's pairing overlay on the presentation page

  A script on the presentation page can register a pairing: something the audience uses to
  join, such as a QR code. Q shows it over the slide, and Escape or Q again hides it. A deck
  with no pairing has no overlay, and Q does nothing.

  @issue-27
  Scenario: The shortcut shows the add-on's pairing overlay and Escape hides it
    Given the "addons" deck is built
    And the deck page is open
    When the key "q" is pressed
    Then the pairing overlay shows "Scan to join"
    And a screenshot "display-pairing" is saved
    When the key "Escape" is pressed
    Then the pairing overlay is hidden

  @issue-27
  Scenario: Without a pairing add-on the shortcut shows nothing
    Given the "basic" deck is built
    And the deck page is open
    When the key "q" is pressed
    Then the pairing overlay is hidden
